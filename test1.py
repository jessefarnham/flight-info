
import json
import logging
import sys

from flask import Flask
import persistent
import transaction
from typing import Tuple
import ZEO


class DB:

    con = None

    @classmethod
    def get_con(cls):
        if not cls.con:
            cls.con = ZEO.connection(8090)
        return cls.con


def update(n):
    con = DB.get_con()
    root = con.root()
    status = PlaneStatus(n)
    root.status = status
    transaction.commit()


def get():
    con = DB.get_con()
    con.sync()
    root = con.root()
    return root.status.is_flying


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


