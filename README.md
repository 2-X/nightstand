# Free Sleep: 8 Sleep Manager

## WARNING
This software is very new and may require troubleshooting debugging on your end. If you need help, you're welcome to reach out on github here.

Installing this is not recommended if you're not comfortable with linux or programming.

See disclaimer and license @ LICENSE.md

## Is it reversible?
As far as I can tell, it should be reversible by simply [resetting the firmware](docs/pod_teardown/10_firmware_reset.jpeg) on your device and setting it up as a new pod again. (ASSUMING you ONLY followed the instructions within this repo)

## Tested and confirmed compatible devices
Check the back of your pod where you plug in the water tubes, 
- Pod 3 - FCC ID: 2AYXT61100001


## Known bugs
- If you have firewall rules setup, sometimes the date gets out of sync, THIS WILL BREAK SCHEDULING. Fixing this is on my to-do list...

## Features
- Allows complete control of device WITHOUT requiring internet access. If you lose internet, your pod WILL NOT turn off, it will continue working! You can completely block WAN internet access if you'd like too. (I blocked all internet access from my pod on my router...)
- WARNING: This will bypass blocked devices, please use responsibly.
- Dynamic temperature control with real-time updates.
- Schedule management: 
  - Set power on/off times 
  - Schedule temperature adjustments.
  - Schedule daily time to prime the pod
  - Alarms (WORK IN PROGRESS)
- Settings customization: Configure timezones, away mode
- Responsive design for desktop and mobile.

## Limitations
- Requires your device to be on the same Wi-Fi as the pod
- No authentication is implemented
- Does not have sleep statistics available (like HRV, hear rate, REM time, snore time, etc.)
  - (I'm happy to take a look at adding that if someone can help find where that's stored)

--- 

## Overview
Free Sleep is an open-source project designed to control and manage temperature schedules and settings for a device locally. It includes:
- **Server**: A backend that interacts with the device through custom APIs.
- **App**: A frontend React application for user-friendly interaction with the device.

This project is intended to be entirely ran on an 8 sleep pod

---

### **Server**
- REST API for managing device settings, schedules, and status.
- Modular design with routes for `deviceStatus`, `settings`, `schedules`, and `execute`.
- Uses Node.js and Express for lightweight, fast operations.

---

## Tech Stack
- **Server**: Node.js, Express, TypeScript.
- **App**: React, Material-UI, Zustand, React Query.
- **Database**: LowDB for simple JSON-based storage.

---

## App screenshots

![Temperature control](docs/temperature.png)
![Scheduling](docs/scheduling.png)
![Temperature adjustments](docs/temp_adjustments.png)
![Settings](docs/settings.png)
![Behavior](docs/free_sleep.gif)

## Future planned work
- Adding support for alarms and scheduling
- Making the UI "prettier"
- Identifying sources for advanced metrics (HRV, heart rate, snoring)


## Contributing

- I'm happy to approve pull requests as long as it makes sense, clearly documented, and in TypeScript

---

## Support

If you find this project helpful and would like to support its continued development, you can send a tip to my Bitcoin address.   

BTC Address:
bc1q9lufvly76gwrrlyt27hc2djywnxf2slnpfr9zx

Thank you for your support!
