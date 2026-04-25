class TaskQueue {
  constructor() {
    this.queue = [];
    this.processing = 0;
    this.maxConcurrent = 3; // Process up to 3 links in parallel
  }

  async add(task) {
    return new Promise((resolve, reject) => {
      // Prioritize task (simple FIFO for now, but ready for logic)
      this.queue.push({ task, resolve, reject, addedAt: Date.now() });
      this.process();
    });
  }

  async process() {
    if (this.processing >= this.maxConcurrent || this.queue.length === 0) return;
    
    this.processing++;
    const { task, resolve, reject } = this.queue.shift();
    
    try {
      // Execute task
      const result = await task();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.processing--;
      // Adaptive delay between processing to maintain smooth throughput
      const nextDelay = this.queue.length > 5 ? 100 : 500;
      setTimeout(() => this.process(), nextDelay);
    }
  }
}

module.exports = new TaskQueue();
