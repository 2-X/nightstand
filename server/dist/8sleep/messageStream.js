export class MessageStream {
    stream;
    separator;
    buffer = Buffer.alloc(0);
    constructor(stream, separator = Buffer.from('\n\n')) {
        this.stream = stream;
        this.separator = separator;
    }
    async readMessage() {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const index = this.buffer.indexOf(this.separator);
            if (index >= 0) {
                const message = this.buffer.slice(0, index);
                const messageLength = index + this.separator.length;
                this.buffer = this.buffer.slice(messageLength);
                return message;
            }
            await this.needMoreData();
        }
    }
    async needMoreData() {
        const read = await this.stream.read();
        if (read === undefined)
            throw new Error('stream ended');
        this.buffer = Buffer.concat([this.buffer, read]);
    }
}
