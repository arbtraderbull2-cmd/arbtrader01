import MetaTrader5 as mt5
from config import ACCOUNTS

def connect(exchange: str):
    """Connect to a specific exchange account."""
    if exchange not in ACCOUNTS:
        print(f"Unknown exchange: {exchange}. Choose from {list(ACCOUNTS.keys())}")
        return False

    creds = ACCOUNTS[exchange]

    if not mt5.initialize(
        login=creds["account"],
        password=creds["password"],
        server=creds["server"]
    ):
        print(f"Failed to connect to {exchange}:", mt5.last_error())
        return False

    info = mt5.account_info()
    print(f"Connected to {exchange} | Account: {info.login} | Balance: {info.balance} {info.currency}")
    return True

def disconnect():
    mt5.shutdown()
    print("Disconnected.")