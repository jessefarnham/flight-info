FROM ubuntu:19.04

MAINTAINER Jesse Farnham jessefarnham1@gmail.com

RUN apt-get update -y && \
    apt-get install -y python3-pip python3-dev gunicorn3

COPY ./requirements.txt /app/requirements.txt

WORKDIR /app

RUN pip3 install -r requirements.txt

COPY . /app

EXPOSE 4000/tcp

ENTRYPOINT [ "/bin/bash" ]

CMD [ "launcher.sh" ]

