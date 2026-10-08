# Deployment Guide

Example of the plain-markdown layout: any `.md`/`.txt` file inside a vault root
becomes an index entry, no `metadata.json` required.

## Steps

1. Tag the release.
2. Build the bundle.
3. Run the smoke test against a staging vault.
4. Roll forward; never patch a running host in place.
