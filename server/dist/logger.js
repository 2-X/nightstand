import winston from 'winston';
import 'winston-daily-rotate-file';
import moment from 'moment-timezone';
const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
    // Custom timestamp formatting
    winston.format.timestamp({
        format: () => {
            const date = new Date();
            return moment.utc(date).format('YYYY-MM-DD HH:mm:ss [UTC]');
        },
    }), 
    // Custom log formatter
    winston.format.printf(({ timestamp, level, message }) => {
        return `${timestamp} | ${level.padStart(8)} | ${message}`;
    })),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(winston.format.colorize(), winston.format.printf(({ timestamp, level, message }) => {
                return `${timestamp} | ${level.padStart(15)} | ${message}`;
            })),
        }),
        new winston.transports.DailyRotateFile({
            level: 'debug',
            filename: '/persistent/free-sleep-data/logs/free-sleep-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            zippedArchive: false,
            maxSize: '5m',
            maxFiles: '3d'
        }),
    ],
});
export default logger;
