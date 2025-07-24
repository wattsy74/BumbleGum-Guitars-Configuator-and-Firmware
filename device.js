const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

class DeviceManager {
  constructor() {
    this.connectedPort = null;
    this.parser = null;
  }

  async listPorts() {
    try {
      const ports = await SerialPort.list();
      return ports.filter(port => 
        port.vendorId && port.productId &&
        (port.manufacturer?.toLowerCase().includes('circuitpython') ||
         port.productName?.toLowerCase().includes('circuitpython') ||
         port.serialNumber?.toLowerCase().includes('circuitpython'))
      );
    } catch (error) {
      console.error('Error listing ports:', error);
      return [];
    }
  }

  async connect(portPath) {
    try {
      if (this.connectedPort && this.connectedPort.isOpen) {
        await this.disconnect();
      }

      this.connectedPort = new SerialPort({
        path: portPath,
        baudRate: 115200,
        autoOpen: false
      });

      this.parser = this.connectedPort.pipe(new ReadlineParser({ delimiter: '\n' }));

      return new Promise((resolve, reject) => {
        this.connectedPort.open((err) => {
          if (err) {
            reject(err);
          } else {
            console.log(`Connected to ${portPath}`);
            resolve(this.connectedPort);
          }
        });
      });
    } catch (error) {
      console.error('Connection error:', error);
      throw error;
    }
  }

  async disconnect() {
    if (this.connectedPort && this.connectedPort.isOpen) {
      return new Promise((resolve) => {
        this.connectedPort.close(() => {
          console.log('Disconnected from device');
          this.connectedPort = null;
          this.parser = null;
          resolve();
        });
      });
    }
  }

  isConnected() {
    return this.connectedPort && this.connectedPort.isOpen;
  }

  getPort() {
    return this.connectedPort;
  }

  getParser() {
    return this.parser;
  }
}

module.exports = new DeviceManager();
