import json
import logging
import sys

from flask import Flask
import persistent
import transaction
from typing import Tuple
import ZEO
import ZODB, ZODB.FileStorage


app = Flask(__name__)


log = logging.getLogger()


conn = ZEO.connection(8090)
root = conn.root()


class PlaneStatus(persistent.Persistent):

    def __init__(self, is_flying: bool) -> None:
        self._is_flying = is_flying
        self._lat = None
        self._long = None

    def set_pos(self, lat: float, long: float) -> None:
        self._lat = lat
        self._long = long

    @property
    def pos(self) -> Tuple[float, float]:
        return (self._lat, self._long)

    @property
    def is_flying(self) -> bool:
        return self._is_flying


@app.route('/')
def hello_world():
    try:
        root.plane_status
    except AttributeError:
        log.info('Could not find plane_status, setting to not flying')
        set_not_flying()
    is_flying = root.plane_status.is_flying
    if is_flying:
        return 'Jesse is flying! Yay!'
    else:
        return 'Jesse is not flying... sad...'


@app.route('/set-flying')
def set_flying():
    root.plane_status = PlaneStatus(is_flying=True)
    transaction.commit()
    return 'Set to flying'

@app.route('/set-not-flying')
def set_not_flying():
    root.plane_status = PlaneStatus(is_flying=False)
    transaction.commit()
    return 'Set to not flying'


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0')
