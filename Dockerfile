FROM ubuntu:19.04

MAINTAINER Jesse Farnham jessefarnham1@gmail.com

RUN apt-get update -y && \
    apt-get install -y python3-pip python3-dev gunicorn3

COPY ./requirements.txt /app/requirements.txt

WORKDIR /app

RUN pip3 install -r requirements.txt

COPY . /app

EXPOSE 4000/tcp

ENTRYPOINT [ "gunicorn3" ]

CMD [ "-w 4", "-b 0.0.0.0:4000", "-k gevent", "app:app" ]

