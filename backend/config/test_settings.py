from .settings import *  # noqa: F403

# Tests must never create databases or read/write data on the configured Neon hosts.
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
SECRET_KEY = 'isolated-tests-only'
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
