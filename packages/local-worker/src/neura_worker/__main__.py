import sys

from .protocol import serve

if __name__ == "__main__":
    serve(sys.stdin.buffer, sys.stdout.buffer)
