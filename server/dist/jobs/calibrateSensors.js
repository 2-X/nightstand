import { executePythonScript } from './executePython.js';
// force skips the script's bed-occupancy guard. Only pass it for
// user-initiated runs (the Status page button), where the user is asserting
// the bed is empty; scheduled runs keep the guard.
export const executeCalibrateSensors = (side, startTime, endTime, force = false) => {
    executePythonScript({
        script: '/home/dac/free-sleep/biometrics/sleep_detection/calibrate_sensor_thresholds.py',
        args: [
            `--side=${side}`,
            `--start_time=${startTime}`,
            `--end_time=${endTime}`,
            ...(force ? ['--force'] : [])
        ]
    });
};
//# sourceMappingURL=calibrateSensors.js.map