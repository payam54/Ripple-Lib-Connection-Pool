'use strict'

import EventEmitter from 'events'

/**
 * Todo
 *  2. Disconnect Connect: Fetch gap
 *  3. Submit and watch TX
 */

class KyteConnection extends EventEmitter {
  constructor (Uri) {
    super()

    var ThisConnection = this

    const REQ_SERVER_INFO_INTERVAL = 10
    const REQ_SERVER_FEE_INTERVAL = 2
    const MAX_FEE_HISTORY_LENGTH = 35

    const RippleAPI = require('ripple-lib').RippleAPI
    const api = new RippleAPI({ server: Uri })

    var Stats = {
      uri: Uri,
      connected: false,
      timer: 0,
      fee: {
        last: null,
        avg: null,
        switched: 0,
        switchFactor: null,
        history: [],
        timer: 0
      },
      ledger: {
        last: null,
        completeLedgers: '',
        count: 0,
        timer: 0
      },
      server: {
        pubkeyNode: '',
        buildVersion: '',
        peers: 0
      }
    }

    var Private = {
      connection: null,
      active: true,
      fnConnect: null,
      fnReconnect: null,
      fnRetryConnect: null,
      retryIn: 0
    }

    var Wallets = []

    Object.assign(this, {
      Uri: Uri,
      getStats () {
        return Stats
      },
      forceReconnect () {
        if (Private.active && Stats.connected) {
          api.disconnect()
        }
      },
      destruct () {
        Private.active = false
        api.disconnect()
      },
      addWallet (wallet) {
        Wallets.push(wallet)
        if (Stats.connected) {
          api.connection.request({
            command: 'subscribe',
            accounts: [ wallet ]
          })
        }
      },
      removeWallet (wallet) {
        if (typeof wallet === 'string') {
          wallet = wallet.trim()
          var walletIndex = Wallets.indexOf(wallet)
          if (walletIndex > -1) {
            Wallets.splice(walletIndex, 1)
            if (Stats.connected) {
              api.connection.request({
                command: 'unsubscribe',
                accounts: [ wallet ]
              })
            }
          }
        }
      },
      getAccountInfo (account, callback, callbackError) {
        if (Private.active && Stats.connected) {
          api.getAccountInfo(account).then((Response) => {
            callback(Uri, Response)
          }).catch((e) => {
            callbackError(Uri, e)
          })
          return true
        }
        return false
      },
      getTransaction (tx, callback, callbackError) {
        if (Private.active && Stats.connected) {
          api.getTransaction(tx).then((Response) => {
            callback(Uri, Response)
          }).catch((e) => {
            callbackError(Uri, e)
          })
          return true
        }
        return false
      },
      getTransactions (account, callback, callbackError, options) {
        if (Private.active && Stats.connected) {
          api.getTransactions(account, options).then((Response) => {
            callback(Uri, Response)
          }).catch((e) => {
            callbackError(Uri, e)
          })
          return true
        }
        return false
      }
    })

    setInterval(function () {
      Stats.timer++
      Stats.fee.timer++
      Stats.ledger.timer++
    }, 1000)

    var setConnected = function (connectedState) {
      if (Stats.connected !== connectedState) {
        Stats.timer = 0
        Stats.fee.switched = 0
      }
      Stats.connected = connectedState
    }

    var connect
    connect = function () {
      api.connect().then(() => {
        // Connected, will be handled by 'api.on' below
      }).catch((e) => {
        Private.fnRetryConnect(e, 'fnConnect::connect')
      })
    }

    Private.fnRetryConnect = function (e, from) {
      setConnected(false)

      if (Private.active) {
        console.log('Ripple-lib connection exception @ <' + from + '>, retry in', Private.retryIn, Uri, e)

        setTimeout(() => {
          connect()
          Private.retryIn += 5
          if (Private.retryIn > 30) {
            Private.retryIn = 30
          }
        }, Private.retryIn * 1000)
      }
    }

    Private.fnConnect = function () {
      connect()
    }

    Private.fnReconnect = function () {
      api.connection._ws.close()
    }

    var parseCompleteLedgers = function (ledgerStr) {
      if (Stats.ledger.completeLedgers !== ledgerStr) {
        Stats.ledger.timer = 0
      }
      Stats.ledger.completeLedgers = ledgerStr
      var l = (ledgerStr + '').split(',').map(function (e) {
        if (e.match(/-/)) {
          var d = e.split('-')
          return parseInt(d[1]) - parseInt(d[0])
        } else {
          return 1
        }
      }).reduce(function (a, cv) {
        return a + cv
      })
      Stats.ledger.count = l
      var lastLedger = parseInt((ledgerStr + '').split(',').reverse()[0].split('-').reverse()[0])
      if (!isNaN(lastLedger)) {
        Stats.ledger.last = lastLedger
        ThisConnection.emit('ledger', {
          uri: Uri,
          ledger: lastLedger
        })
      }
    }

    api.on('connected', () => {
      // May be destroyed already
      if (Private.active) {
        console.log('Connected', Uri)
        setConnected(true)

        api.connection.request({
          command: 'subscribe',
          streams: [ 'ledger' ]
        })

        if (Wallets.length > 0) {
          api.connection.request({
            command: 'subscribe',
            accounts: Wallets
          })
        }

        api.connection._ws.on('message', function (m) {
          if (Private.active) {
            var message = JSON.parse(m)
            if (message.type === 'ledgerClosed') {
              parseCompleteLedgers(message.validated_ledgers)
            } else {
              if (message.type === 'transaction' && message.validated) {
                var TxForWallet = ''
                if (Wallets.indexOf(message.transaction.Account) > -1) {
                  TxForWallet = message.transaction.Account
                } else {
                  if (Wallets.indexOf(message.transaction.Destination) > -1) {
                    TxForWallet = message.transaction.Destination
                  }
                }

                if (TxForWallet !== '') {
                  // console.log('TX', TxForWallet, message.transaction.hash, Uri)
                  ThisConnection.emit('tx', {
                    uri: Uri,
                    hash: message.transaction.hash,
                    wallet: TxForWallet,
                    message: message
                  })
                }
              }
            }
          }
        })

        var getFee
        getFee = function () {
          if (Private.active && Stats.connected) {
            api.getFee().then(function (fee) {
              fee = Math.ceil(parseFloat(fee) * 1000 * 1000)

              if (fee !== Stats.fee.last) {
                Stats.fee.switched++
              }
              Stats.fee.last = fee
              Stats.fee.history.unshift(Stats.fee.last)
              Stats.fee.timer = 0
              Stats.fee.switchFactor = Stats.timer > 0 ? Math.round(Stats.fee.switched / Stats.timer * 100) / 100 : null
              Stats.fee.avg = Math.ceil(Stats.fee.history.reduce((a, b) => {
                return a + b
              }, 0) / Stats.fee.history.length)

              if (Stats.fee.history.length > MAX_FEE_HISTORY_LENGTH) {
                Stats.fee.history = Stats.fee.history.splice(0, MAX_FEE_HISTORY_LENGTH)
              }

              setTimeout(function () {
                getFee()
              }, REQ_SERVER_FEE_INTERVAL * 1000)
            })
          }
        }
        getFee()

        var getServerInfo
        getServerInfo = function () {
          if (Private.active && Stats.connected) {
            api.getServerInfo().then(function (server) {
              Stats.server = server
              parseCompleteLedgers(server.completeLedgers)

              setTimeout(function () {
                getServerInfo()
              }, REQ_SERVER_INFO_INTERVAL * 1000)

              setConnected(true)
            }).catch((e) => {
              setConnected(false)
            })
          }
        }
        getServerInfo()
      } else {
        // !Private.active, destroy
        api.disconnect()
      }
    })

    api.on('disconnected', (code) => {
      console.log('Disconnected', Uri, code)
      Private.fnRetryConnect({ code: code }, 'api::disconnected')
    })

    try {
      Private.fnConnect()
    } catch (e) {
      Private.fnRetryConnect(e, 'catch::fnConnect')
    }
  }
}

class KyteConnectionPool extends EventEmitter {
  constructor (servers) {
    super()

    var ThisConnectionPool = this
    const MAX_HEALTH_HISTORY_LENGTH = 25
    const MAX_TX_LEDGER_OFFSET = 10
    const MAX_TX_HISTORY_LENGTH = 1000
    const MAX_TX_FIRSTRESPONDER_LENGTH = 150
    const MAX_TX_FIRSTRESPONDER_DURATION_MINUTES = 2
    const WEIGHT_FIRST_RESPONDER_PERCENTAGE = 1.5
    const MAX_TIMEOUT_RECONNECT_SECONDS = 45
    const MAX_REQ_RESPONSE_DURATION_SEC = 10
    const MAX_REQ_TRYNEXT_DURATION_SEC = 0.5

    var Wallets = []
    var Servers = []
    var State = {
      healthy: [],
      servers: {
        count: 0,
        connected: 0,
        healthy: 0,
        avgFee: null,
        health: {}
      },
      ledger: {
        last: null,
        timer: null
      },
      timer: 0
    }

    var RecentTx = {
      hashes: [],
      firstResponders: [],
      count: 0
    }

    var calculateState

    var processTransaction = function (tx) {
      if (State.ledger.last !== null && tx.message.ledger_index > State.ledger.last - MAX_TX_LEDGER_OFFSET) {
        if (RecentTx.hashes.indexOf(tx.hash) < 0) {
          RecentTx.hashes.unshift(tx.hash)
          RecentTx.firstResponders.unshift({ uri: tx.uri, ts: Math.round(Date.now() / 1000) })
          if (RecentTx.hashes.length > MAX_TX_HISTORY_LENGTH) {
            RecentTx.hashes = RecentTx.hashes.splice(0, MAX_TX_HISTORY_LENGTH)
          }
          if (RecentTx.firstResponders.length > MAX_TX_FIRSTRESPONDER_LENGTH) {
            RecentTx.firstResponders = RecentTx.firstResponders.splice(0, MAX_TX_FIRSTRESPONDER_LENGTH)
          }
          tx.id = RecentTx.count
          // console.log(tx)
          ThisConnectionPool.emit('tx', tx)
          RecentTx.count++
        }
      }
    }
    var connectedServerRequest = function (method, type, id, callback, options) {
      var checkedServers = []
      var responseErrors = []
      var tries = 0
      var calledCallback = false

      var __callback = function (data) {
        if (!calledCallback) { // Server may be slow and answer late, re-call-callback
          callback(data)
          if (data.success) {
            calledCallback = true
          }
        }
      }

      var maxResponseTimeout = setTimeout(() => {
        __callback({
          success: false,
          tries: tries,
          [type]: id,
          message: 'Timeout, no satisfactory response, not all servers answered',
          errors: responseErrors
        })
      }, MAX_REQ_RESPONSE_DURATION_SEC * 1000)

      var getNextServer = function () {
        var nextServers = Object.keys(ThisConnectionPool.getState().servers.health).map((s) => {
          return ThisConnectionPool.getState().servers.health[s]
        }).sort(function (a, b) {
          if (a.score > b.score) return -1
          if (a.score < b.score) return 1
          return 0
        }).filter((s) => {
          return checkedServers.indexOf(s.uri) < 0
        }).filter((s) => {
          var serverMatch = Servers.filter((f) => {
            return f.Uri === s.uri
          })
          if (serverMatch.length > 0) {
            var thisServerState = serverMatch[0].getStats()
            if (thisServerState.connected) {
              if (typeof options === 'object' && Object.keys(options).indexOf('maxLedgerVersion') > -1) {
                var firstLedger = parseInt(thisServerState.server.completeLedgers.split(',')[0].split('-')[0])
                if (firstLedger > parseInt(options.maxLedgerVersion)) {
                  // no need, no ledger history
                  return false
                }
              }
              return true
            }
          }
          return false
        })
        if (nextServers.length > 0) {
          var nextServer = nextServers[0]
          checkedServers.push(nextServer.uri)
          return Servers.filter((f) => {
            return f.Uri === nextServer.uri
          })[0]
        }
        return null
      }

      var tryServer = function (i) {
        var thisServer = getNextServer()

        if (thisServer !== null) {
          tries++
          var tryNext = function () {
            tryServer(i + 1)
          }
          var tryNextTimeout = setTimeout(tryNext, MAX_REQ_TRYNEXT_DURATION_SEC * 1000)
          var gotResponse = function () {
            clearTimeout(tryNextTimeout)
            clearTimeout(maxResponseTimeout)
          }
          console.log('[ try call ]', method, thisServer.Uri)
          thisServer[method](id, function (Uri, Response) {
            gotResponse()
            RecentTx.firstResponders.unshift({ uri: Uri, ts: Math.round(Date.now() / 1000) })
            __callback({
              success: true,
              tries: tries,
              uri: Uri,
              [type]: id,
              response: Response
            })
          }, function (Uri, Err) {
            gotResponse()
            responseErrors.push({ uri: Uri, error: Err })
            tryNext()
          }, options)
        } else {
          // Wait for answer, or have maxResponseTimeout kick in
          // clearTimeout(maxResponseTimeout)
          // __callback({
          //   success: false,
          //   tries: tries,
          //   [type]: id,
          //   message: 'Tried all connected servers, no satisfactory response',
          //   errors: responseErrors
          // })
        }
      }

      tryServer(0)
    }

    Object.assign(this, {
      removeServer (server) {
        // console.log('Remove', server)
        var remove = Servers.filter((s) => {
          return s.Uri === server.trim()
        })
        if (remove.length > 0) {
          console.log('Destruct', server)
          remove[0].destruct()
          Servers.splice(Servers.indexOf(remove[0]), 1)
        }
      },
      addServer (server) {
        if (server.match(/^http/)) {
          server = server.replace(/^http/, 'ws')
        }
        if (typeof server === 'string' && server.match(/^wss:/) && Servers.filter((s) => {
          return s.Uri === server
        }).length < 1) {
          var uri = server.trim()
          var NewKyteConnection = new KyteConnection(uri)
          Wallets.forEach((w) => {
            NewKyteConnection.addWallet(w)
          })
          NewKyteConnection.on('tx', (tx) => {
            processTransaction(tx)
          })
          NewKyteConnection.on('ledger', (closedLedger) => {
            if (State.ledger.last === null || closedLedger.ledger > State.ledger.last) {
              State.ledger.last = closedLedger.ledger
              console.log('Ledger', State.ledger.last)
            }
          })
          State.servers.health[uri] = {
            uri: uri,
            serverIndex: Servers.push(NewKyteConnection) - 1,
            healthy: false,
            score: 0,
            scoreAvg: 0,
            recentFirstResponder: {
              count: 0,
              percentage: 0
            },
            recentScores: [],
            healthPoints: {}
          }
        }
      },
      getServers () {
        return Servers.map((s) => {
          return s.getStats()
        })
      },
      getState (options) {
        return State
      },
      addWallet (wallet) {
        if (typeof wallet === 'string') {
          wallet = wallet.trim()
          if (wallet.match(/^r/) && Wallets.indexOf(wallet) < 0) {
            Servers.forEach((s) => {
              s.addWallet(wallet)
            })
            Wallets.push(wallet)
          }
        }
      },
      removeWallet (wallet) {
        if (typeof wallet === 'string') {
          wallet = wallet.trim()
          var walletIndex = Wallets.indexOf(wallet)
          if (walletIndex > -1) {
            Wallets.splice(walletIndex, 1)
            Servers.forEach((s) => {
              s.removeWallet(wallet)
            })
          }
        }
      },
      getAccountInfo (account, callback) {
        if (typeof callback === 'function') {
          if (account.trim().match(/^r[a-zA-Z0-9]+$/)) {
            connectedServerRequest('getAccountInfo', 'account', account, callback)
          } else {
            throw new Error('getAccountInfo: invalid account (1st arg)')
          }
        } else {
          throw new Error('getAccountInfo: Callback (function) required (2nd arg)')
        }
      },
      getTransaction (tx, callback) {
        if (typeof callback === 'function') {
          if (tx.trim().toUpperCase().match(/^[A-F0-9]+$/)) {
            connectedServerRequest('getTransaction', 'tx', tx, callback)
          } else {
            throw new Error('getTransaction: invalid TX (non-hex) (1st arg)')
          }
        } else {
          throw new Error('getTransaction: Callback (function) required (2nd arg)')
        }
      },
      getTransactions (account, options, callback) {
        if (typeof callback === 'function') {
          if (account.trim().match(/^r[a-zA-Z0-9]+$/)) {
            var txsOptions = {
              limit: 10
            }
            if (typeof options === 'object') {
              Object.keys(options).filter((o) => {
                return o.match(/^[a-zA-Z0-9_-]+$/)
              }).forEach((o) => {
                txsOptions[o] = options[o]
              })
            }
            connectedServerRequest('getTransactions', 'account', account, callback, txsOptions)
          } else {
            throw new Error('getAccountInfo: invalid account (1st arg)')
          }
        } else {
          throw new Error('getTransaction: Callback (function) required (2nd arg)')
        }
      }
    })

    calculateState = function () {
      State.timer++

      var serversStats = Servers.map((s) => {
        return s.getStats()
      })
      var connectedServersStats = serversStats.filter((s) => {
        return s.connected
      })

      if (connectedServersStats.length < 1) return

      // Clean Old (X (MAX_TX_FIRSTRESPONDER_DURATION_MINUTES) minute) First Responders TX
      var RecentTxOld = -1
      RecentTx.firstResponders.forEach((r) => {
        if (r.ts < Math.round(Date.now() / 1000) - (60 * MAX_TX_FIRSTRESPONDER_DURATION_MINUTES) && RecentTxOld < 0) {
          RecentTxOld = RecentTx.firstResponders.indexOf(r)
        }
      })
      if (RecentTxOld > -1) {
        RecentTx.firstResponders = RecentTx.firstResponders.splice(0, RecentTxOld)
        // console.log('Truncate RecentTX at', RecentTxOld)
      }

      // Calculate average fee :: average fee.
      var connectedServersAvgFee = Math.ceil(connectedServersStats.map((s) => {
        return s.fee.avg
      }).reduce((a, b) => {
        return a + b
      }, 0) / connectedServersStats.length)

      var sortedServersBy = function (FnField, Direction) {
        var sorted = serversStats.sort(function (a, b) {
          if (FnField(a) < FnField(b)) return -1
          if (FnField(a) > FnField(b)) return 1
          return 0
        })
        if (typeof Direction !== 'number') {
          Direction = 1
        }
        if (Direction < 0) {
          sorted = sorted.reverse()
        }
        return FnField(sorted[0])
      }

      var mostRecentLedger = sortedServersBy((s) => {
        return s.ledger.last
      }, -1)
      var serverHealth = []
      serversStats.forEach((s) => {
        var ledgerOffset = mostRecentLedger - s.ledger.last
        var thisHealth = {
          uri: s.uri,
          health: 0,
          healthCalculation: {
            disconnected: !s.connected ? -15 : 0,
            ledgerOffset: ledgerOffset > 1 ? (ledgerOffset > 3 ? -15 : (ledgerOffset - 1) * -1) : 0,
            feeVsAvg: s.fee.last < connectedServersAvgFee ? 1 : 0,
            avgFeeAvg: s.fee.avg < connectedServersAvgFee * 1.25 ? 1 : 0,
            feeSwitch: s.fee.switchFactor < 0.5 ? (s.fee.switchFactor < 0.1 ? 2 : 1) : -3,
            ledgerTimer: s.ledger.timer > 8 ? -10 : 0,
            peerCount: s.server.peers > 10 ? 1 : (s.server.peers < 5 ? -2 : 0),
            lowFee: s.fee.last < 150 ? 1 : 0,
            xtraLowFee: s.fee.last < 50 ? 1 : 0,
            lowFeeAvg: s.fee.avg < 350 ? 1 : 0,
            highFee: s.fee.last > 5000 ? -1 : 0,
            highFeeAvg: s.fee.avg > 2500 ? -1 : 0,
            serverUptime: s.server.uptime > 60 * 60 * 24 * 2 ? 2 : (s.server.uptime < 60 * 30 ? -2 : 0),
            longUp: s.connected && s.timer > 60 * 3 ? 1 : 0,
            firstResponder: 0
          }
        }
        var prevHealth = State.servers.health[s.uri].score
        thisHealth.health = Object.keys(thisHealth.healthCalculation).map((k) => {
          return thisHealth.healthCalculation[k]
        }).reduce((a, b) => {
          return a + b
        }, 0)
        if (thisHealth.health > 4 && RecentTx.firstResponders.length > 3) {
          // First Responder is worth nothing if the general health isn't great.
          thisHealth.healthCalculation.firstResponder = State.servers.health[s.uri].recentFirstResponder.percentage > 1 / connectedServersStats.length * 100 ? Math.floor(State.servers.health[s.uri].recentFirstResponder.percentage / 10 / WEIGHT_FIRST_RESPONDER_PERCENTAGE) : 0
          thisHealth.health += thisHealth.healthCalculation.firstResponder
        }
        if (prevHealth >= -2 && thisHealth.health > prevHealth && thisHealth.health - prevHealth > 1) {
          // Allow state increase only in increment of 1
          thisHealth.health = prevHealth + 1
        }
        if (prevHealth < -2 && thisHealth.health > prevHealth && thisHealth.health - prevHealth > 5 && State.timer > 5) {
          // Allow state increase only in increment of 5 if state < -2 and alive for at least 5 seconds
          thisHealth.health = prevHealth + 5
        }
        serverHealth.push(thisHealth)
      })
      serverHealth = serverHealth.sort(function (a, b) {
        if (a.health < b.health) return 1
        if (a.health > b.health) return -1
        return 0
      })

      State.servers.count = servers.length
      State.servers.connected = connectedServersStats.length
      State.servers.avgFee = connectedServersAvgFee
      State.servers.healthy = 0
      State.healthy = []
      serverHealth.forEach((s) => {
        State.servers.health[s.uri].recentFirstResponder.count = RecentTx.firstResponders.filter((r) => {
          return r.uri === s.uri
        }).length
        State.servers.health[s.uri].recentFirstResponder.percentage = Math.round(State.servers.health[s.uri].recentFirstResponder.count / RecentTx.firstResponders.length * 100 * 100) / 100
        State.servers.health[s.uri].score = s.health
        State.servers.health[s.uri].recentScores.unshift(s.health)
        if (State.servers.health[s.uri].recentScores.length > MAX_HEALTH_HISTORY_LENGTH) {
          State.servers.health[s.uri].recentScores = State.servers.health[s.uri].recentScores.slice(0, MAX_HEALTH_HISTORY_LENGTH)
        }
        State.servers.health[s.uri].healthPoints = s.healthCalculation
        State.servers.health[s.uri].scoreAvg = Math.floor(State.servers.health[s.uri].recentScores.reduce((a, b) => {
          return a + b
        }, 0) / State.servers.health[s.uri].recentScores.length)

        State.servers.health[s.uri].healthy = (State.servers.health[s.uri].score >= 0 && State.servers.health[s.uri].scoreAvg >= 0)

        if (State.servers.health[s.uri].healthy) {
          State.servers.healthy++
          State.healthy.push({
            uri: State.servers.health[s.uri].uri,
            serverIndex: State.servers.health[s.uri].serverIndex,
            score: State.servers.health[s.uri].score
          })
        }
        State.healthy.sort(function (a, b) {
          if (a.score < b.score) return 1
          if (a.score > b.score) return -1
          return 0
        })
      })
      State.ledger.last = mostRecentLedger
      State.ledger.timer = sortedServersBy((s) => {
        return s.ledger.timer
      })
    }

    var reconnectStalledServers = function () {
      Servers.forEach((s) => {
        var sStats = s.getStats()
        if (sStats.connected && sStats.timer > MAX_TIMEOUT_RECONNECT_SECONDS && sStats.fee.timer > MAX_TIMEOUT_RECONNECT_SECONDS && sStats.ledger.timer > MAX_TIMEOUT_RECONNECT_SECONDS) {
          // Check if both fee.timer && ledger.timer are > MAX_TIMEOUT_RECONNECT_SECONDS,
          // since if it's only the ledger and not the fee, the server is still responding
          // but it is not in sync. No need to reconnect.
          if (sStats.ledger.last < State.ledger.last - 10) {
            // Still in connected state, but no new ledger for > MAX_TIMEOUT_RECONNECT_SECONDS seconds
            // and ledger min. 10 behind State.ledger.last (most recent ledger) - force reconnect
            s.forceReconnect()
          }
        }
      })
    }

    calculateState()
    setInterval(calculateState, 1000)
    setInterval(reconnectStalledServers, 4 * 1000)

    if (typeof servers === 'string') {
      servers = servers.replace(/[^a-zA-Z0-9]:\/\.-/g, ' ').split(' ')
    }
    if (typeof servers === 'object') {
      servers.forEach((s) => {
        this.addServer(s)
      })
    }
  }
}

export default KyteConnectionPool
