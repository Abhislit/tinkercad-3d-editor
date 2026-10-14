#!/bin/sh
# Static server for the editor. ES modules need a real origin, so file:// will not work.
exec python3 -m http.server "${PORT:-8137}" --bind 127.0.0.1