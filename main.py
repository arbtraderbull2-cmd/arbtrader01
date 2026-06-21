from mt5_client import connect, disconnect

EXCHANGES = ["DG", "COMEX", "IND"]

for exchange in EXCHANGES:
    print(f"\n--- Testing {exchange} ---")
    if connect(exchange):
        print(f"✓ {exchange} connected successfully!")
        disconnect()
    else:
        print(f"✗ {exchange} failed, moving to next...")

print("\nAll accounts tested.")