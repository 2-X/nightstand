import { executePythonScript } from './executePython.js';
export const analyzeSleepKey = (side) => `analyzeSleep:${side}`;
export const executeAnalyzeSleep = (side, startTime, endTime) => {
    executePythonScript({
        key: analyzeSleepKey(side),
        script: '/home/dac/free-sleep/biometrics/sleep_detection/analyze_sleep.py',
        args: [
            `--side=${side}`,
            `--start_time=${startTime}`,
            `--end_time=${endTime}`
        ]
    });
};
//# sourceMappingURL=analyzeSleep.js.map