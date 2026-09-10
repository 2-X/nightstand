# Adaptive temperature (experimental)

The Pod hosts `/adaptive-temperature`, with per-person off, observe and active
modes. Default is observe. Runtime state is stored privately at
`/persistent/free-sleep-data/adaptive-temperature.json`, with atomic replacement,
file and directory fsync. It is outside the schedule LowDB watcher.

Physical-button/app intent cancels queued automatic writes synchronously, holds
that side until the end of its session and is persisted before hardware writes.
A restart conservatively holds any ongoing session. Manual controls remain
usable if adaptive storage fails; automatic writes are disabled in that case.
Confirmed temperature changes retain source and side. Alarm dismissals do not
train preferences. Unknown target changes hold automation. Schedule steps pause
adaptation for 30 minutes; alarm warm ramps hold it for the rest of the session.
Automatic writes never call the REST manual-control route or power a side on.

Sessions start when an enabled bed side reports presence, last at most twelve
hours and require an observed off state before the next session. Continuous
presence for thirty minutes plus fresh vitals are only a sleep proxy. There is
no validated stage classifier in this controller. False negatives cause holds;
occupancy can also describe a person who is awake.

Circulation is a fresh source-timestamped RAW `frzHealth` heartbeat. Each side
requires explicit water=true and RPM >=1800 (observed running RPM ~1900–2000).
Missing, malformed, replayed or stale data cannot indicate healthy circulation.
Only localhost can supply the heartbeat. This is additional monitoring, not a
replacement for firmware safety limits or a medical safety certification.

The policy uses the final confirmed preference per elapsed-night phase on at
least three distinct nights within 21 days, with targets agreeing within 2°F.
The learned median is confined to configured bounds and ±2°F of the baseline;
steps are at most 1°F and at least thirty minutes apart. These numerical limits
are cautious engineering choices, not validated clinical doses. No adjustment
is evidence of neither good sleep nor thermal comfort.

Evidence: Raymann et al. 2008 (https://pubmed.ncbi.nlm.nih.gov/18192289/) supports
individualized thermoregulation; skin warming is not a Pod-water target.
Stevenson et al. 2025 (https://pmc.ncbi.nlm.nih.gov/articles/PMC12550930/) found
improved subjective comfort/sleep without significant objective improvements.
Do not claim maximal sleep, increased deep sleep or clinical efficacy.

Deploy only through `ops/deploy.sh`, from a clean commit, while the bed is off.
`POD_HOST=pod POD_ADDRESS=10.0.4.51 POD_IP=10.0.4.51 ops/deploy.sh` works without mDNS.
The normal backup, health-check and rollback path applies. No schema migrations
or hardware/firmware changes are needed. An old code rollback ignores the
additive adaptive state file.
