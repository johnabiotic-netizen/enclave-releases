"""Checks a new location database before Enclave apps download it.

Usage: check_location_db.py NEW.mmdb OLD.mmdb

Fails when the file isn't a GeoIP2-City style database, when 8.8.8.8 isn't in the US, or
when the new database disagrees with the previous one on the country of more than 3 % of
sampled addresses (a broken or wrong file, not normal reassignment).
"""

import random
import sys

import maxminddb


def country(reader, ip):
    rec = reader.get(ip)
    if not rec:
        return None
    c = rec.get("country") or {}
    loc = rec.get("location") or {}
    return c.get("iso_code"), loc.get("time_zone")


def main():
    new = maxminddb.open_database(sys.argv[1])
    old = maxminddb.open_database(sys.argv[2])
    if "City" not in new.metadata().database_type:
        sys.exit(f"unexpected database type {new.metadata().database_type}")
    google = country(new, "8.8.8.8")
    if not google or google[0] != "US" or not google[1]:
        sys.exit(f"8.8.8.8 looks wrong: {google}")

    rng = random.Random(20261103)
    both = same = 0
    for _ in range(20000):
        ip = ".".join(str(rng.randint(1, 223) if i == 0 else rng.randint(0, 255)) for i in range(4))
        a, b = country(new, ip), country(old, ip)
        if a and b and a[0] and b[0]:
            both += 1
            same += a[0] == b[0]
    if both < 5000:
        sys.exit(f"only {both} of 20000 sampled addresses found in both databases")
    share = same / both
    print(f"countries agree for {same} of {both} sampled addresses ({share:.2%})")
    if share < 0.97:
        sys.exit("too many countries changed; not publishing")


main()
