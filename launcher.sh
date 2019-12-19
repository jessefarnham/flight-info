#!/bin/bash

python3 -m ZEO.runzeo -C zeo.config &

gunicorn3 -w 4 -b 0.0.0.0:4000 -k gevent app:app

