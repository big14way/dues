# Prebuilt contracts

`pnpm build:contract` uses these when Rust and `cargo-near` are not installed, so `pnpm demo:dry` and `pnpm sandbox` run with Node alone. When `cargo-near` is installed it rebuilds from source and refreshes these files, so a source change shows up in `git diff`.

| File | Size | sha256 | NEAR code hash (base58 of the sha256) |
|---|---|---|---|
| `dues.wasm` | 244,738 bytes | `99c3daaef0f5225a9313047881d6720e7b6a0736bc521b156da9b199a3822e69` | `BMEbMGmYqKb25aoJ64QKh4rb17GLpLKJpFACqudfYcpY` |
| `mock_usdc.wasm` | 151,189 bytes | `96a73da7dd5c7c5811ae5007d90f61187f401e4eeceaf67b49ae94c7b9cb0096` | `B964fzB5jgTmHEkb4dXnMbCthFqj3V3bsUxdSscZBGmK` |

`dues.wasm` is the code running on [`dues.testnet`](https://testnet.nearblocks.io/address/dues.testnet). Check it yourself:

```bash
curl -s https://rpc.testnet.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"dues.testnet"}}' \
  | grep -o '"code_hash":"[^"]*"'
# "code_hash":"BMEbMGmYqKb25aoJ64QKh4rb17GLpLKJpFACqudfYcpY"
```

`mock_usdc.wasm` is a minimal NEP-141 token used only on the local sandbox.

Built with `cargo near build non-reproducible-wasm --locked` (cargo-near 0.22, near-sdk 5.30).
