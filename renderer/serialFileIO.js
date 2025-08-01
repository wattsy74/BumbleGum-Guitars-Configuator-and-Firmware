// serialFileIO.js
// Robust serial file read/write for BGG Windows App

const DEFAULT_TIMEOUT = 15000; // Enhanced default timeout (15s) - Increased timeout for file operations

/**
 * Reads a file from a serial device using the READFILE command.
 * Buffers until END marker, handles timeouts and errors.
 * @param {SerialPort} port - An open SerialPort instance
 * @param {string} filename - The filename to read (e.g. 'boot.py')
 * @param {number} [timeoutMs] - Optional timeout in ms
 * @returns {Promise<string>} - Resolves with file content, rejects on error/timeout
 */
function readFile(port, filename, timeoutMs = DEFAULT_TIMEOUT) {
  return new Promise(async (resolve, reject) => {
    // Remove all lingering 'data' listeners before starting a new read
    port.removeAllListeners('data');
    // Optionally flush the buffer if available
    if (typeof port.flush === 'function') {
      try {
        await new Promise((res, rej) => {
          port.flush(err => err ? rej(err) : res());
        });
        console.log('[serialFileIO] Serial buffer flushed before readFile:', filename);
      } catch (flushErr) {
        console.warn('[serialFileIO] Serial buffer flush failed before readFile', filename, flushErr);
      }
    }
    
    // Add small delay to let firmware reset completely
    await new Promise(res => setTimeout(res, 50));
    
    let buffer = '';
    let finished = false;
    let resolved = false;
    console.log(`[serialFileIO] readFile called for filename: ${filename}`);
    const timer = setTimeout(() => {
      if (!finished && !resolved) {
        finished = true;
        resolved = true;
        port.off('data', onData);
        console.warn(`[serialFileIO] [TIMEOUT] Listener removed for ${filename}`);
        console.warn(`[serialFileIO] [TIMEOUT] Buffer dump for ${filename}:`, buffer);
        reject(new Error(`Timeout reading file: ${filename}`));
      }
    }, timeoutMs);
    function cleanupListeners() {
      port.off('data', onData);
      console.log(`[serialFileIO] Listener cleanup for ${filename}`);
    }
    function onData(data) {
      if (resolved) return;
      const str = data.toString();
      buffer += str;
      // Log the first 100 chars of the buffer for every chunk
      const preview = buffer.length > 100 ? buffer.slice(0, 100) + '...' : buffer;
      console.log(`[serialFileIO][DEBUG] Buffer preview for ${filename}:`, preview);
      console.log(`[serialFileIO] Data received for ${filename}:`, str);
      // Robust END marker detection: match END_filename on its own line, at end, or with trailing whitespace
      if (new RegExp(`END_${filename.replace('.', '\\.')}\\s*$`, 'm').test(buffer)) {
        finished = true;
        resolved = true;
        clearTimeout(timer);
        cleanupListeners();
        // Extract content between START_filename and END_filename markers with enhanced contamination filtering
        const startMarker = `START_${filename}`;
        const endMarker = `END_${filename}`;
        
        let content = '';
        const lines = buffer.split(/\r?\n/);
        let capturing = false;
        let startFound = false;
        
        for (const line of lines) {
          const trimmed = line.trim();
          
          if (trimmed === startMarker) {
            capturing = true;
            startFound = true;
            content = ''; // Reset content when we find the start marker
            console.log(`[serialFileIO][MARKER] Found START marker for ${filename}`);
            continue;
          }
          
          if (trimmed === endMarker) {
            if (startFound) {
              console.log(`[serialFileIO][MARKER] Found END marker for ${filename}`);
              capturing = false;
              break;
            } else {
              console.warn(`[serialFileIO][MARKER] Found END marker for ${filename} without START - ignoring`);
              continue;
            }
          }
          
          if (capturing && startFound) {
            // Enhanced contamination filtering - reject lines that look like firmware artifacts
            if (trimmed === 'FIRMWARE_READY:OK' || 
                trimmed.includes('FIRMWARE_VERSIONS') ||
                trimmed.includes('"code.py"') ||
                trimmed.includes('"hardware.py"') ||
                trimmed.includes('"utils.py"') ||
                trimmed.includes('"gamepad.py"') ||
                trimmed.includes('"serial_handler.py"') ||
                trimmed.includes('"pin_detect.py"')) {
              console.log(`[serialFileIO][FILTER] Filtered contamination for ${filename}: ${trimmed}`);
              continue;
            }
            
            if (content.length > 0) content += '\n';
            content += line;
          }
        }
        
        // Additional validation - check if we actually found both markers
        if (!startFound) {
          console.error(`[serialFileIO][ERROR] No START marker found for ${filename} in buffer`);
          reject(new Error(`No START marker found for ${filename}`));
          return;
        }
        
        content = content.trim();
        
        // CRITICAL: Remove any trailing END marker that might have been included
        const endMarkerPattern = new RegExp(`\\s*END_${filename.replace('.', '\\.')}\\s*$`);
        if (endMarkerPattern.test(content)) {
          content = content.replace(endMarkerPattern, '').trim();
          console.log(`[serialFileIO][CLEANUP] Removed trailing END marker from ${filename} content`);
        }
        
        // Log the first 100 chars of the final content
        const contentPreview = content.length > 100 ? content.slice(0, 100) + '...' : content;
        console.log(`[serialFileIO][DEBUG] Final content preview for ${filename}:`, contentPreview);
        console.log(`[serialFileIO] Final content for ${filename}:`, content);
        console.log(`[serialFileIO] Promise resolved for ${filename}`);
        resolve(content);
      }
    }
    port.on('data', onData);
    port.write(`READFILE:${filename}\n`);
  });
}

/**
 * Writes a file to a serial device using the WRITEFILE command.
 * Handles timeouts and errors.
 * @param {SerialPort} port - An open SerialPort instance
 * @param {string} filename - The filename to write (e.g. 'user_presets.json')
 * @param {string|Buffer} content - The file content to write
 * @param {number} [timeoutMs] - Optional timeout in ms
 * @returns {Promise<boolean>} - Resolves true on success, rejects on error/timeout
 */
function writeFile(port, filename, content, timeoutMs = DEFAULT_TIMEOUT) {
  return new Promise((resolve, reject) => {
    let ackReceived = false;
    let errorReceived = false;
    const allResponses = []; // Track all responses for debugging
    console.log(`[serialFileIO] writeFile starting for ${filename}, timeout: ${timeoutMs}ms`);
    
    // Special handling for CircuitPython system files that trigger automatic reboot
    const isSystemFile = filename === 'boot.py' || filename === 'code.py';
    
    if (isSystemFile) {
      console.log(`[serialFileIO] Writing system file ${filename} - CircuitPython will reboot immediately`);
    }
    
    const actualTimeout = isSystemFile ? 1000 : timeoutMs; // Very short timeout for system files
    
    const timer = setTimeout(() => {
      if (!ackReceived && !errorReceived) {
        port.off('data', onData);
        if (isSystemFile) {
          console.log(`[serialFileIO] ${filename} write completed (assuming success - CircuitPython rebooted)`);
          resolve(true); // Assume success for system files since CircuitPython reboots immediately
        } else {
          console.error(`[serialFileIO] TIMEOUT writing ${filename} after ${actualTimeout}ms`);
          console.error(`[serialFileIO] All responses received during timeout:`, allResponses);
          reject(new Error(`Timeout writing file: ${filename}. Responses: ${allResponses.join(', ')}`));
        }
      }
    }, actualTimeout);
    
    function onData(data) {
      const str = data.toString();
      allResponses.push(str.trim()); // Track all responses
      console.log(`[serialFileIO] writeFile received data for ${filename}:`, JSON.stringify(str));
      
      if (str.includes('✅ File') || str.includes('written')) {
        ackReceived = true;
        clearTimeout(timer);
        port.off('data', onData);
        console.log(`[serialFileIO] writeFile SUCCESS for ${filename}`);
        resolve(true);
      } else if (str.includes('ERROR:') || str.includes('❌')) {
        errorReceived = true;
        clearTimeout(timer);
        port.off('data', onData);
        console.error(`[serialFileIO] writeFile ERROR for ${filename}. All responses:`, allResponses);
        reject(new Error(`Error writing file: ${filename}. Error: ${str.trim()}`));
      } else if (str.includes('FIRMWARE_READY')) {
        console.log(`[serialFileIO] Received FIRMWARE_READY during ${filename} write - ignoring`);
      } else {
        console.log(`[serialFileIO] Received unexpected response during ${filename} write:`, JSON.stringify(str));
      }
    }
    port.on('data', onData);
    console.log(`[serialFileIO] Sending WRITEFILE command for ${filename}`);
    port.write(`WRITEFILE:${filename}\n`);
    console.log(`[serialFileIO] Sending content for ${filename} (${content.length} bytes)`);
    port.write(content);
    port.write('\nEND\n');
    console.log(`[serialFileIO] writeFile commands sent for ${filename}`);
  });
}

module.exports = {
  readFile,
  writeFile
};
