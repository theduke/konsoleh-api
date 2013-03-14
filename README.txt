KONSOLEH-API
============

This is an "artificial" API client for hetzner.de's konsoleh management console.
KonsoleH does not actually have an API.
This project tries to enable API-like management by utilizing phantomjs.

Requirements
------------

Phantomjs (embedded webkit): http://phantomjs.org/

Usage
-----

phantomjs konsoleh.js --user="username" --password="pw" CMD

Available commands
