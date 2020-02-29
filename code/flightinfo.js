
const AWS = require('aws-sdk');
const https = require('https');
const mockHistoricalTrackResult = require('./mockHistoricalTrackResult');

const dynamo = new AWS.DynamoDB.DocumentClient({region: 'us-east-1'});

const aircraftTableName = process.env.aircraftTableName;
const pollerTableName = process.env.pollerTableName;
const lastTrackTableName = process.env.lastTrackTableName;
const flightXmlAuth = process.env.flightXmlAuth;

const maxMisses = 5;
const defaultTailNumber = 'N76616';

const configKey = 'pollerConfig';
const numMissesKey = 'numMisses';
const activeTailNumberKey = 'activeTailNumber';
const useMockFlightXmlKey = 'useMockFlightXml';
const trackKey = 'track';
const trackValue = 'latest';

const epsilon = 1e-6;

const allowedEmailSenders = [
    'Jesse Farnham <jessefarnham1@gmail.com>',
    'FlightAware Alerts <alerts@flightaware.com>'
];

const startPollingSubjectPrefix = 'N76616 spotted in flight';
const stopPollingSubjectPrefix = 'N76616 tracking stopped';

const mockData = {
    "InFlightInfoResult": {
        "faFlightID": "N313EZ-1580587719-1-0-246",
        "ident": "N76616",
        "prefix": "",
        "type": "SR22",
        "suffix": "",
        "origin": "KOYM",
        "destination": "KPTK",
        "timeout": "ok",
        "timestamp": 1580591691,
        "departureTime": 1580589965,
        "firstPositionTime": 1580589965,
        "arrivalTime": 0,
        "longitude": -80.14283,
        "latitude": 41.85242,
        "lowLongitude": -80.14283,
        "lowLatitude": 41.43070,
        "highLongitude": -78.56010,
        "highLatitude": 41.85242,
        "groundspeed": 150,
        "altitude": 61,
        "heading": 290,
        "altitudeStatus": "",
        "updateType": "TA",
        "altitudeChange": "C",
        "waypoints": "41.41 -78.5 41.44 -78.6 41.44 -78.61 41.66 -79.39 41.69 -79.52 41.75 -79.77 41.76 -79.8 41.76 -79.82 41.84 -80.08 42.11 -81.13 42.29 -81.86 42.41 -82.33 42.45 -82.52 42.58 -83.03 42.6 -83.12 42.6 -83.13 42.61 -83.19 42.63 -83.27 42.66 -83.38 42.67 -83.42"
    }
};

const emptyMockData = {
    "InFlightInfoResult": {
        "faFlightID": "N313EZ-1580587719-1-0-246",
        "ident": "N76616",
        "prefix": "",
        "type": "",
        "suffix": "",
        "origin": "",
        "destination": "",
        "timeout": "",
        "timestamp": 0,
        "departureTime": 0,
        "firstPositionTime": 0,
        "arrivalTime": 0,
        "longitude": 0,
        "latitude": 0,
        "lowLongitude": 0,
        "lowLatitude": 0,
        "highLongitude": 0,
        "highLatitude": 0,
        "groundspeed": 0,
        "altitude": 0,
        "heading": 0,
        "altitudeStatus": "",
        "updateType": "",
        "altitudeChange": "",
        "waypoints": ""
    }
};

function respondHttp(cb, extractor) {
    return function(err, resp) {
        if (err){
            cb(err)
        }
        else {
            let _extractor = extractor || function(resp) {return resp};
            cb(null, {
                statusCode: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify(_extractor(resp))
            })
        }
    }
}

function update(evt, ctx, cb) {
    let item = JSON.parse(evt.body);
    _update(item, cb)
}

function _update(item, cb) {
    console.log('update(), item=' + JSON.stringify(item));
    dynamo.put({
            Item: item,
            TableName: aircraftTableName},
            respondHttp(cb)
    )
}

function get(evt, ctx, cb) {
    const tailNumber = evt.pathParameters.tailNumber;
    _get(tailNumber, cb)
}

function _get(tailNumber, cb) {
    dynamo.get(
        {
            Key: {
                tailNumber: tailNumber
            },
            TableName: aircraftTableName
        },
        respondHttp(cb, function(resp) {return resp.Item})
    )
}

function list(evt, ctx, cb) {
    dynamo.scan(
        {TableName: aircraftTableName},
        respondHttp(cb)
    )
}

function _updateWithFlightXml(activeTailNumber, useMock, cb) {
    let flightXmlResult;
    if (useMock) {
        if (activeTailNumber === defaultTailNumber) {
            flightXmlResult = mockData
        } else {
            flightXmlResult = emptyMockData
        }
        console.log('Called mock flightXML, result=' + JSON.stringify(flightXmlResult));
        postFlightXmlCallback(flightXmlResult.InFlightInfoResult, activeTailNumber, useMock, cb);
    }
    else {
        const params = {
            host: 'flightxml.flightaware.com',
            path: '/json/FlightXML2/InFlightInfo?ident=' + activeTailNumber,
            method: 'GET',
            headers: {
                Authorization: 'Basic ' + flightXmlAuth
            }
        };
        let req = https.request(params, function(result) {
            let data = '';
            console.log('FlightXml status=' + result.statusCode);
            if (result.statusCode !== 200) {
                _incrementNumMisses(cb);
            }
            else {
                result.setEncoding('utf8');
                result.on('data', function (chunk) {
                    data += chunk;
                });
                result.on('end', function () {
                    console.log('Got data from FlightXml');
                    let flightXmlResult = JSON.parse(data);
                    postFlightXmlCallback(flightXmlResult.InFlightInfoResult, activeTailNumber, useMock, cb)
                })
            }
        });
        req.end();
    }
}

function _checkStaleData(flightXmlResult, lastPayload) {
    if (typeof lastPayload.Item === 'undefined') {
        return false
    }
    else {
        return (Math.abs(lastPayload.Item.lat - flightXmlResult.latitude) < epsilon &&
                Math.abs(lastPayload.Item.long - flightXmlResult.longitude) < epsilon)
    }
}

function _saveLastTrack(payload, useMock, cb) {
    let historicalTrackResult;
    let err;
    if (useMock) {
        historicalTrackResult = mockHistoricalTrackResult.mockResult;
    }
    else {
        const params = {
            host: 'flightxml.flightaware.com',
            path: '/json/FlightXML2/GetHistoricalTrack?faFlightID=' + payload.faFlightID,
            method: 'GET',
            headers: {
                Authorization: 'Basic ' + flightXmlAuth
            }
        };
        let req = https.request(params, function(result) {
            let data = '';
            console.log('FlightXml GetHistoricalTrack status=' + result.statusCode);
            if (result.statusCode !== 200) {
                err = 'FlightXml GetHistoricalTrack returned status ' + result.statusCode;
            }
            else {
                result.setEncoding('utf8');
                result.on('data', function (chunk) {
                    data += chunk;
                });
                result.on('end', function () {
                    console.log('Got data from FlightXml GetHistoricalTrack');
                    historicalTrackResult = JSON.parse(data);
                    console.log(historicalTrackResult)
                })
            }
        });
        req.end();
    }
    if (err) {
        cb(err)
    }
    else {
        historicalTrackResult[trackKey] = trackValue;
        for (let i = 0; i <  historicalTrackResult.GetHistoricalTrackResult.data.length; i++) {
            delete historicalTrackResult.GetHistoricalTrackResult.data[i].altitudeStatus;
            delete historicalTrackResult.GetHistoricalTrackResult.data[i].altitudeChange;
        }
        console.log(JSON.stringify(historicalTrackResult));
        console.log(lastTrackTableName);
        dynamo.put({
                Item: historicalTrackResult,
                TableName: lastTrackTableName
            },
            cb
        )
    }
}

function getLastTrack(evt, ctx, cb) {
    let dynamoKey = {};
    dynamoKey[trackKey] = trackValue;
    dynamo.get(
        {
            Key: dynamoKey,
            TableName: lastTrackTableName
        },
        respondHttp(cb, function(resp) {return resp.Item})
    )
}

function _setToNotFlying(activeTailNumber, useMock, cb) {
    dynamo.get(
        {
            Key: {
                tailNumber: activeTailNumber
            },
            TableName: aircraftTableName
        },
        (err, lastPayload) => {
            if (err) {
                cb(err)
            }
            else {
                let payload = lastPayload.Item;
                payload.isFlying = false;
                console.log('payload=' + JSON.stringify(payload));
                let callback = function(err, _) {
                    if (err){
                        cb(err)
                    }
                    else {
                        _saveLastTrack(payload, useMock, cb);
                    }
                };
                _update(payload, callback)
            }
        }
    )
}

function postFlightXmlCallback(flightXmlResult, activeTailNumber, useMock, cb) {
    dynamo.get(
        {
            Key: {
                tailNumber: activeTailNumber
            },
            TableName: aircraftTableName
        },
        (err, lastPayload) => {
            if (err) {
                cb(err)
            }
            else {
                let payload;
                let numMissOperation;
                let lastTrackOperation;
                if (flightXmlResult.latitude && flightXmlResult.longitude) {
                    console.log('Aircraft is flying');
                    let stale = _checkStaleData(flightXmlResult, lastPayload);
                    payload = {
                        tailNumber: flightXmlResult.ident, isFlying: true,
                        lat: flightXmlResult.latitude, long: flightXmlResult.longitude,
                        altitude: flightXmlResult.altitude,
                        heading: flightXmlResult.heading,
                        groundspeed: flightXmlResult.groundspeed,
                        isStale: stale,
                        faFlightID: flightXmlResult.faFlightID
                    };
                    numMissOperation = _resetNumMisses;
                    lastTrackOperation = (payload, useMock, cb) => {cb(null, 'No track update needed.')};
                }
                else {
                    console.log('Aircraft not flying');
                    payload = {tailNumber: activeTailNumber, isFlying: false,
                        lat: null, long: null, faFlightID: flightXmlResult.faFlightID};
                    numMissOperation = _incrementNumMisses;
                    lastTrackOperation = _saveLastTrack;
                }
                let callback = function(err, _) {
                    if (err){
                        _incrementNumMisses(cb);
                        cb(err)
                    }
                    else {
                        numMissOperation((err, _) => {
                            if (err) {
                                cb(err)
                            }
                            else {
                                lastTrackOperation(payload, useMock, cb)
                            }
                        });
                    }
                };
                _update(payload, callback)
            }
        }
    )
}

function _getConfig(cb) {
    dynamo.get(
        {
            Key: {
                configKey: configKey
            },
            TableName: pollerTableName
        },
        (err, data) => {
            if (err) {
                cb(err)
            }
            else {
                cb(null, data.Item);
            }
        }
    )
}

function poll(evt, ctx, cb) {
    _getConfig((err, data) => {
            if (err) {
                cb(err)
            }
            else {
                console.log('poll(), current config settings=' + JSON.stringify(data));
                const activeTailNumber = data[activeTailNumberKey] || defaultTailNumber;
                const prevNumMisses = data[numMissesKey] || 0;
                if (prevNumMisses < maxMisses) {
                    console.log('poll(), calling updateWithFlightXml');
                    _updateWithFlightXml(activeTailNumber, data[useMockFlightXmlKey], cb)
                }
                else {
                    console.log('poll(), no-op');
                    cb(null, 'no-op, awaiting next startPolling call')
                }
            }
        }
    );
}

function setActiveTailNumber(evt, ctx, cb) {
    const tailNumber = evt.pathParameters.tailNumber;
    dynamo.update({
            Key: {configKey: configKey},
            UpdateExpression: `SET ${activeTailNumberKey} = :t`,
            ExpressionAttributeValues: {':t': tailNumber},
            TableName: pollerTableName},
        respondHttp(cb)
    )
}

function getActiveFlightInfo(evt, ctx, cb) {
    dynamo.get(
        {
            Key: {
                configKey: configKey
            },
            TableName: pollerTableName
        },
        function (err, resp) {
            if (err) {
                cb(err)
            }
            else {
                _get(resp.Item.activeTailNumber || defaultTailNumber, cb)
            }
        }
    )
}

function startPolling(evt, ctx, cb) {
    console.log('startPolling');
    _resetNumMisses(cb)
}

function stopPolling(evt, ctx, cb) {
    console.log('stopPolling');
    _getConfig((err, config) => {
            if (err) {
                cb(err)
            }
            else {
                _resetNumMisses((err, _) => {
                    if (err) {
                        cb(err)
                    }
                    else {
                        _setToNotFlying(config[activeTailNumberKey],
                            config[useMockFlightXmlKey], cb)
                    }
                }, maxMisses)
            }
        }
    );
}

function _resetNumMisses(cb, newValue=0) {
    console.log('resetNumMisses()');
    dynamo.update({
            Key: {configKey: configKey},
            UpdateExpression: `SET ${numMissesKey} = :n`,
            ExpressionAttributeValues: {':n': newValue},
            TableName: pollerTableName},
        cb
    )
}

function _incrementNumMisses(cb) {
    console.log('incrementNumMisses()');
    dynamo.update({
            Key: {configKey: configKey},
            UpdateExpression: `SET ${numMissesKey} = ${numMissesKey} + :n`,
            ExpressionAttributeValues: {':n': 1},
            TableName: pollerTableName},
        cb
    )
}

function setConfig(evt, ctx, cb) {
    let item = JSON.parse(evt.body);
    item.configKey = configKey;
    dynamo.put({
            Item: item,
            TableName: pollerTableName},
        respondHttp(cb)
    )
}

function handleEmail(evt, ctx, cb) {
    const mail = evt.Records[0].ses.mail;
    console.log(mail);
    const from = mail.commonHeaders.from[0];
    const subject = mail.commonHeaders.subject;
    if (allowedEmailSenders.includes(from) && subject.startsWith(startPollingSubjectPrefix)){
        startPolling(evt, ctx, cb);
    }
    else if (allowedEmailSenders.includes(from) && subject.startsWith(stopPollingSubjectPrefix)) {
        stopPolling(evt, ctx, cb);
    }
    else {
        cb(null, {result: `No action taken; from=${from}, subject=${subject}`});
    }
}

module.exports = {
    update,
    get,
    list,
    poll,
    getActiveFlightInfo,
    setActiveTailNumber,
    startPolling,
    stopPolling,
    setConfig,
    handleEmail,
    getLastTrack
};

