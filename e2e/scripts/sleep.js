function sleep(milliseconds) {
  const start = Date.now();
  while (Date.now() - start < Number(milliseconds)) {
    // Busy-wait loop does nothing
  }
}

sleep(WAIT_MS)
