# Test-only updater fixtures

These files exist so the tests in `src/commands/update.rs` can check a signature end to end
against a local server. The key here is for tests only. It signs nothing that is shipped, and the
app never trusts it (the app's own public key is in `tauri.conf.json`).

- `test-only.key` / `test-only.key.pub`: a throw-away key pair without a password.
- `app.tar.gz` (+ `.sig`): a stand-in package, signed with the test key.
- `other.bin` (+ `.sig`): another file signed with the same key, to get a valid signature that
  does not belong to `app.tar.gz`.

Made with (from this directory):

```sh
npx tauri signer generate --ci -p "" -w test-only.key
printf 'not really an app' > app.tar.gz
printf 'some other file' > other.bin
npx tauri signer sign -f test-only.key -p "" app.tar.gz
npx tauri signer sign -f test-only.key -p "" other.bin
```
