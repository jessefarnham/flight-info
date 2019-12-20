import json
import logging
import sys

from flask import Flask
import persistent
import transaction
from typing import Tuple
import ZEO


ZEO_PORT = 8090


app = Flask(__name__)


log = app.logger


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
    con = ZEO.connection(ZEO_PORT)
    root = con.root()
    print(root)
    try:
        root.plane_status
    except AttributeError:
        log.info('Could not find plane_status, setting to not flying')
        return 'Cannot find status.\n'
    is_flying = root.plane_status.is_flying
    if is_flying:
        return 'Jesse is flying! Yay!\n'
    else:
        return 'Jesse is not flying... sad...\n'


@app.route('/set-flying')
def set_flying():
    con = ZEO.connection(ZEO_PORT)
    root = con.root()
    root.plane_status = PlaneStatus(is_flying=True)
    transaction.commit()
    return 'Set to flying\n'

@app.route('/set-not-flying')
def set_not_flying():
    con = ZEO.connection(ZEO_PORT)
    root = con.root()
    root.plane_status = PlaneStatus(is_flying=False)
    transaction.commit()
    return 'Set to not flying\n'


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0')
