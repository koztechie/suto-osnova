export function parseJsonBody(req, maxBytes = 1048576) {
  const method = req.method || '';
  const contentType = req.headers['content-type'] || '';

  if (method === 'GET' || method === 'HEAD') {
    return Promise.resolve(null);
  }

  if (!contentType.includes('application/json')) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let overflowed = false;

    req.on('data', (chunk) => {
      if (overflowed) return;
      size += chunk.length;
      if (size > maxBytes) {
        // Stop consuming but keep the socket alive so the 413 envelope
        // can actually reach the client (task 35: every failure leaves a
        // structured response). The socket is destroyed by the error
        // responder once the response is flushed.
        overflowed = true;
        req.pause();
        const err = new Error('Payload Too Large');
        err.status = 413;
        reject(err);
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(null);
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.length === 0) {
        resolve(null);
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        req.body = parsed;
        resolve(parsed);
      } catch {
        const err = new Error('Invalid JSON');
        err.status = 400;
        reject(err);
      }
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}
