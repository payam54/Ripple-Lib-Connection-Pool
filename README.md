# ripple-lib-connection-pool

Connect to multiple **rippled** (Docker image) nodes using websockets, and load balance / select nodes based on load, health, etc. 

The pool offers support for both fast limited history nodes and full history nodes in one pool, and will query multiple nodes if required.

To test / debug, you can use the [VueJS based Development Dashboard](https://github.com/WietseWind/Ripple-Lib-Connection-Pool-Dashboard) ([demo](https://gwuycm3.dlvr.cloud/)).

> NOTE! CURRENTLY UNDER DEVELOPMENT, PRE-BETA! ONLY TESTED IN GOOGLE CHROME. DOCS NOT READY, ETC.

# How to use (nodejs / webpack)

To use the Connection Pool, make sure `ripple-lib` is loaded (either using `import` / `require` or using a `script` tag pointing to browserified code).


```
import ConnectionPool from 'ripple-lib-connection-pool'

// Start with a few servers.
// Servers can be added / removed after construnction

let pool = new ConnectionPool([
  'wss://s1.ripple.com',
  'wss://s2.ripple.com'
])
```

## Retrieving stats / health

If you want to debug:

```
let poolState = pool.getState()
let poolServers = pool.getServers()
```

The information retrieved from `getState` and `getServers` are visualized by tue [Development Dashboard](https://github.com/WietseWind/Ripple-Lib-Connection-Pool-Dashboard).

## Servers

##### Add a server to the pool
```
pool.addServer('wss://rippled-dev.xrpayments.co')
```

##### Remove a server from the pool
```
pool.removeServer('wss://s1.ripple.com')
```

## Wallets

##### Watch wallet for transactions (Payment / Escrow / Offers / ...)
```
pool.addWallet('rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv')
```

You can add multiple wallets by invoking the `addWallet` method multiple times. You can invoke `addWallet` at any time, if servers are added later on using `addServer`, the wallets added before adding the server will be auto-watched after the new server is connected.

##### Stop watching wallet for transactions
```
pool.removeWallet('rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv')
```

##### Handle watched transactions

When a transaction is sent / received for a watched wallet, an event will be emitted by the pool. You can watch for events:

```
pool.on('tx', function (tx) {
  console.log(tx)
})
```

## Query the pool

##### Get a transactioon by TxId

```
pool.getTransaction('A67...2B7', function (response) {
  console.log(response)
})
```

##### Get accountInfo (wallet information)

```
pool.getAccountInfo('rXXXXXX...', function (response) {
  console.log(response)
})
```

##### Get account transaction history

To fetch the transaction history for an account, you can leave the `options` argument empty (`null` or `{}`). It will default to the **last 10 transactions**, with the most recent transaction first. If you want to go back in time, you can specify the `limit` (integer) and page by entering the last received ledger number las `maxLedgerVersion` for your next request.

```
let options = {
  limit: 10,
  maxLedgerVersion: 12345
}

getTransactions('rXXXXXX...', options, function (response) {
  console.log(response)
})
```