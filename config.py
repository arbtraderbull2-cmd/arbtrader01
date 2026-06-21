import os
from dotenv import load_dotenv

load_dotenv()

ACCOUNTS = {
    "DG": {
        "account":  int(os.getenv("DG_ACCOUNT")),
        "password": os.getenv("DG_PASSWORD"),
        "server":   os.getenv("DG_SERVER"),
    },
    "COMEX": {
        "account":  int(os.getenv("COMEX_ACCOUNT")),
        "password": os.getenv("COMEX_PASSWORD"),
        "server":   os.getenv("COMEX_SERVER"),
    },
    "IND": {
        "account":  int(os.getenv("IND_ACCOUNT")),
        "password": os.getenv("IND_PASSWORD"),
        "server":   os.getenv("IND_SERVER"),
    },
}