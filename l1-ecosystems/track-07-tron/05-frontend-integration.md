# Frontend Integration: TronLink and TronWeb

**Track:** Tron Development
**Level:** Intermediate
**Read time:** 14 min

---

## The Problem

You've deployed contracts to Shasta, but users interact with dApps through browsers, not CLIs. Tron's frontend stack uses TronLink (wallet) and TronWeb (SDK) — similar to MetaMask + ethers.js but with Tron-specific patterns around energy estimation, address formats, and event handling. This lesson shows you how to build a complete dApp frontend that connects TronLink, reads contract state, sends transactions, and handles the energy/bandwidth model gracefully.

---

## Core Concepts

### TronWeb SDK Setup

TronWeb is the primary JavaScript library for interacting with Tron. When TronLink is installed, it injects a `tronWeb` instance into the page:

```html
<!-- index.html -->
<!DOCTYPE html>
<html>
<head>
  <title>My Tron dApp</title>
  <!-- TronWeb is injected by TronLink, no CDN needed -->
  <!-- For Node.js projects, install: npm install tronweb@5.3.2 -->
</head>
<body>
  <div id="app">
    <button id="connectBtn">Connect TronLink</button>
    <div id="accountInfo" style="display:none;">
      <p>Address: <span id="address"></span></p>
      <p>Balance: <span id="balance"></span> TRX</p>
      <p>Energy: <span id="energy"></span></p>
      <p>Bandwidth: <span id="bandwidth"></span></p>
    </div>
  </div>
  <script src="app.js"></script>
</body>
</html>
```

### Connecting TronLink Wallet

```javascript
// app.js
// TronLink wallet connection with proper error handling

async function connectTronLink() {
  // Check if TronLink is installed
  if (typeof window.tronLink === "undefined") {
    alert("Please install TronLink wallet extension");
    window.open("https://www.tronlink.org/", "_blank");
    return null;
  }

  // Request connection (triggers TronLink popup)
  try {
    const res = await window.tronLink.request({ method: "tron_requestAccounts" });

    if (res.code === 200) {
      // Connected successfully
      const tronWeb = window.tronWeb;
      const address = tronWeb.defaultAddress.base58;
      console.log("Connected:", address);
      return { tronWeb, address };
    } else if (res.code === 4001) {
      console.log("User rejected connection");
      return null;
    } else {
      console.error("Connection failed:", res.message);
      return null;
    }
  } catch (error) {
    console.error("TronLink error:", error);
    return null;
  }
}

// Listen for account changes
window.addEventListener("message", (event) => {
  if (event.data.message && event.data.message.action === "accountsChanged") {
    const newAddress = event.data.message.data.address;
    console.log("Account changed to:", newAddress);
    updateUI(newAddress);
  }
});

// Listen for network changes
window.addEventListener("message", (event) => {
  if (event.data.message && event.data.message.action === "setNode") {
    const node = event.data.message.data.node;
    console.log("Network changed to:", node.fullNode);
    location.reload(); // Reload to use new network
  }
});
```

### Reading Account Resources

```javascript
// Fetch account balance, energy, and bandwidth
async function getAccountResources(tronWeb, address) {
  try {
    // Get TRX balance
    const balanceSun = await tronWeb.trx.getBalance(address);
    const balanceTRX = balanceSun / 1e6;

    // Get account resources (energy + bandwidth)
    const resources = await tronWeb.trx.getAccountResources(address);

    const energy = {
      available: (resources.EnergyLimit || 0) - (resources.EnergyUsed || 0),
      total: resources.EnergyLimit || 0,
      used: resources.EnergyUsed || 0
    };

    const bandwidth = {
      available: (resources.freeNetLimit || 0) - (resources.freeNetUsed || 0) +
                 (resources.NetLimit || 0) - (resources.NetUsed || 0),
      freeUsed: resources.freeNetUsed || 0,
      freeLimit: resources.freeNetLimit || 600,
      stakedUsed: resources.NetUsed || 0,
      stakedLimit: resources.NetLimit || 0
    };

    return { balanceTRX, energy, bandwidth };
  } catch (error) {
    console.error("Failed to fetch resources:", error);
    return null;
  }
}

// Display resources in UI
async function updateUI(address) {
  const tronWeb = window.tronWeb;
  const resources = await getAccountResources(tronWeb, address);

  if (resources) {
    document.getElementById("address").textContent = address;
    document.getElementById("balance").textContent = resources.balanceTRX.toFixed(2);
    document.getElementById("energy").textContent =
      `${resources.energy.available.toLocaleString()} / ${resources.energy.total.toLocaleString()}`;
    document.getElementById("bandwidth").textContent =
      `${resources.bandwidth.available.toLocaleString()}`;
    document.getElementById("accountInfo").style.display = "block";
  }
}
```

### Interacting with Smart Contracts

```javascript
// Contract interaction: read and write operations

const CONTRACT_ADDRESS = "TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW"; // Your TRC-20 address

async function getContractInstance(tronWeb) {
  try {
    const contract = await tronWeb.contract().at(CONTRACT_ADDRESS);
    return contract;
  } catch (error) {
    console.error("Failed to load contract:", error);
    return null;
  }
}

// READ: Get token balance (no energy cost — view function)
async function getTokenBalance(contract, address) {
  try {
    const balance = await contract.balanceOf(address).call();
    // TRC-20 with 6 decimals
    return Number(balance) / 1e6;
  } catch (error) {
    console.error("balanceOf failed:", error);
    return 0;
  }
}

// WRITE: Transfer tokens (costs energy)
async function transferTokens(contract, toAddress, amount) {
  try {
    // Convert to smallest unit (6 decimals)
    const amountInSun = Math.floor(amount * 1e6);

    // Estimate energy first
    const energyEstimate = await estimateEnergy(
      CONTRACT_ADDRESS,
      "transfer(address,uint256)",
      [{ type: "address", value: toAddress }, { type: "uint256", value: amountInSun }]
    );

    console.log(`Estimated energy: ${energyEstimate}`);

    // Send transaction (TronLink will prompt user)
    const tx = await contract.transfer(toAddress, amountInSun).send({
      feeLimit: 100000000, // 100 TRX max fee
      shouldPollResponse: false // Don't wait for confirmation
    });

    console.log("Transaction broadcast:", tx);
    return tx;
  } catch (error) {
    if (error.message && error.message.includes("Confirmation declined")) {
      console.log("User rejected transaction");
    } else {
      console.error("Transfer failed:", error);
    }
    return null;
  }
}

// Energy estimation helper
async function estimateEnergy(contractAddress, functionSelector, parameters) {
  const tronWeb = window.tronWeb;
  try {
    const result = await tronWeb.transactionBuilder.triggerConstantContract(
      contractAddress,
      functionSelector,
      {},
      parameters,
      tronWeb.defaultAddress.hex
    );
    return result.energy_used || 0;
  } catch (error) {
    console.error("Energy estimation failed:", error);
    return 65000; // Default estimate for TRC-20 transfer
  }
}
```

### Handling Transaction Confirmation

```javascript
// Poll for transaction confirmation
async function waitForConfirmation(tronWeb, txId, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const txInfo = await tronWeb.trx.getTransactionInfo(txId);

      if (txInfo && txInfo.id) {
        // Transaction is confirmed
        if (txInfo.receipt && txInfo.receipt.result === "SUCCESS") {
          return { success: true, txInfo };
        } else {
          // Transaction failed on-chain
          const revertMsg = txInfo.resMessage
            ? tronWeb.toUtf8(txInfo.resMessage)
            : "Unknown error";
          return { success: false, error: revertMsg, txInfo };
        }
      }
    } catch (error) {
      // Transaction not yet indexed, keep polling
    }

    // Wait 3 seconds (one block time)
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  return { success: false, error: "Confirmation timeout" };
}

// Usage example
async function sendAndConfirm(contract, toAddress, amount) {
  const tronWeb = window.tronWeb;

  // Send transaction
  const txId = await transferTokens(contract, toAddress, amount);
  if (!txId) return;

  // Show pending state
  document.getElementById("status").textContent = "Confirming...";

  // Wait for confirmation
  const result = await waitForConfirmation(tronWeb, txId);

  if (result.success) {
    document.getElementById("status").textContent = "Confirmed!";
    console.log("Energy used:", result.txInfo.receipt.energy_usage_total);
    console.log("Bandwidth used:", result.txInfo.receipt.net_usage);
  } else {
    document.getElementById("status").textContent = `Failed: ${result.error}`;
  }
}
```

### Listening to Contract Events

```javascript
// Subscribe to TRC-20 Transfer events

async function watchTransfers(contractAddress) {
  const tronWeb = window.tronWeb;

  // Method 1: Poll event server (works on all networks)
  async function pollEvents(sinceTimestamp) {
    try {
      const events = await tronWeb.getEventResult(contractAddress, {
        eventName: "Transfer",
        sinceTimestamp: sinceTimestamp,
        size: 50,
        sort: "block_timestamp"
      });

      for (const event of events) {
        const { from, to, value } = event.result;
        const fromBase58 = tronWeb.address.fromHex(from);
        const toBase58 = tronWeb.address.fromHex(to);
        const amount = Number(value) / 1e6;

        console.log(`Transfer: ${fromBase58} → ${toBase58}: ${amount} tokens`);
        onTransferEvent(fromBase58, toBase58, amount, event.transaction);
      }

      return events.length > 0
        ? events[events.length - 1].block_timestamp + 1
        : sinceTimestamp;
    } catch (error) {
      console.error("Event polling failed:", error);
      return sinceTimestamp;
    }
  }

  // Poll every 3 seconds (one block)
  let timestamp = Date.now();
  setInterval(async () => {
    timestamp = await pollEvents(timestamp);
  }, 3000);
}

// Method 2: WebSocket (TronGrid Pro only)
function watchTransfersWebSocket(contractAddress) {
  // Requires TronGrid Pro API key
  const ws = new WebSocket("wss://api.trongrid.io/v1/contracts/" + contractAddress + "/events");

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.eventName === "Transfer") {
      console.log("Real-time transfer:", data.result);
    }
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
  };
}
```

### Complete dApp Example

```javascript
// Full dApp initialization flow

class TronDApp {
  constructor(contractAddress) {
    this.contractAddress = contractAddress;
    this.tronWeb = null;
    this.contract = null;
    this.address = null;
  }

  async init() {
    // Step 1: Connect wallet
    const connection = await connectTronLink();
    if (!connection) return false;

    this.tronWeb = connection.tronWeb;
    this.address = connection.address;

    // Step 2: Verify network (Shasta for testing)
    const network = this.tronWeb.fullNode.host;
    if (!network.includes("shasta")) {
      alert("Please switch to Shasta testnet in TronLink");
      return false;
    }

    // Step 3: Load contract
    this.contract = await getContractInstance(this.tronWeb);
    if (!this.contract) return false;

    // Step 4: Display account info
    await updateUI(this.address);

    // Step 5: Display token balance
    const tokenBalance = await getTokenBalance(this.contract, this.address);
    document.getElementById("tokenBalance").textContent = tokenBalance.toFixed(2);

    // Step 6: Start event listener
    watchTransfers(this.contractAddress);

    return true;
  }

  async transfer(to, amount) {
    if (!this.contract) {
      console.error("Not initialized");
      return;
    }

    // Validate address format
    if (!this.tronWeb.isAddress(to)) {
      alert("Invalid Tron address");
      return;
    }

    // Check sufficient balance
    const balance = await getTokenBalance(this.contract, this.address);
    if (balance < amount) {
      alert(`Insufficient balance. Have: ${balance}, Need: ${amount}`);
      return;
    }

    // Execute transfer
    await sendAndConfirm(this.contract, to, amount);

    // Refresh balance
    const newBalance = await getTokenBalance(this.contract, this.address);
    document.getElementById("tokenBalance").textContent = newBalance.toFixed(2);
  }
}

// Initialize on page load
const app = new TronDApp("TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW");

document.getElementById("connectBtn").addEventListener("click", async () => {
  const success = await app.init();
  if (success) {
    document.getElementById("connectBtn").textContent = "Connected";
    document.getElementById("connectBtn").disabled = true;
  }
});

document.getElementById("transferBtn").addEventListener("click", async () => {
  const to = document.getElementById("recipientInput").value;
  const amount = parseFloat(document.getElementById("amountInput").value);
  if (to && amount > 0) {
    await app.transfer(to, amount);
  }
});
```

### Node.js Backend Integration

```javascript
// server-side/tronweb-backend.js
// For server-side operations (airdrops, monitoring, etc.)

const TronWeb = require("tronweb@5.3.2");

// Initialize TronWeb without wallet (read-only)
const tronWebReadOnly = new TronWeb({
  fullHost: "https://api.shasta.trongrid.io"
  // No privateKey = read-only mode
});

// Initialize with private key (for sending transactions)
const tronWebSigner = new TronWeb({
  fullHost: "https://api.shasta.trongrid.io",
  privateKey: process.env.TRON_PRIVATE_KEY
});

// Server-side token transfer (e.g., for airdrops)
async function serverTransfer(contractAddress, toAddress, amount) {
  const contract = await tronWebSigner.contract().at(contractAddress);
  const amountInSun = Math.floor(amount * 1e6);

  const tx = await contract.transfer(toAddress, amountInSun).send({
    feeLimit: 100000000
  });

  // Wait for confirmation
  const result = await waitForConfirmation(tronWebSigner, tx);
  return result;
}

// Monitor contract events (server-side)
async function monitorEvents(contractAddress) {
  let lastTimestamp = Date.now() - 60000; // Start from 1 minute ago

  setInterval(async () => {
    const events = await tronWebReadOnly.getEventResult(contractAddress, {
      eventName: "Transfer",
      sinceTimestamp: lastTimestamp,
      size: 200
    });

    for (const event of events) {
      // Process event (save to DB, send notification, etc.)
      console.log("New transfer:", event.result);
    }

    if (events.length > 0) {
      lastTimestamp = events[events.length - 1].block_timestamp + 1;
    }
  }, 3000);
}
```

---

## Common Pitfalls

1. **Not waiting for TronLink injection** — TronLink injects `window.tronWeb` asynchronously. If your script runs before injection completes, `window.tronWeb` will be undefined. Use `window.addEventListener('load', ...)` or poll for `window.tronWeb` availability with a timeout rather than checking once on page load.

2. **Ignoring the hex/base58 address mismatch** — Contract events return addresses in hex format (41...), but users expect base58 (T...). Always convert with `tronWeb.address.fromHex(hexAddress)` before displaying to users. Comparing a hex address to a base58 address will always fail.

3. **Setting `shouldPollResponse: true` for user-facing transactions** — When `shouldPollResponse` is true, TronWeb blocks until the transaction is confirmed (~3-57 seconds). This freezes your UI. Set it to `false` and implement your own polling with a loading indicator so users see progress.

4. **Not handling TronLink's locked state** — Users can lock TronLink (like locking MetaMask). When locked, `tronWeb.defaultAddress` returns `false`. Always check `tronWeb.ready` and `tronWeb.defaultAddress.base58` before attempting transactions. Prompt users to unlock if the wallet is locked.

5. **Forgetting energy estimation for UX** — Unlike Ethereum where gas estimation is automatic, Tron requires explicit energy estimation via `triggerConstantContract`. Without showing users the estimated cost before they confirm, they'll be surprised by TRX burns. Always estimate and display the cost in your UI before sending.

---

## What to Learn Next

- [Tron Developer Hub](https://developers.tron.network/) — Official documentation, API reference, and advanced guides
- [TronWeb API Reference](https://developers.tron.network/reference/tronweb-object) — Complete SDK documentation
- [Shasta Testnet Faucet](https://www.trongrid.io/shasta) — Get test TRX for development
