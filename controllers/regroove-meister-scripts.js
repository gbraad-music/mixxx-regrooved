var RegrooveMeister = {
    "Name": "Regroove Meister",
    "deviceSettings": {
        "midiChannel": 0x0F,       // MIDI channel (0x00–0x0F)
        "deviceId": 0x09,          // Arbitrary device ID for SysEx
        "manufacturerId": [0x7D],  // Private manufacturer ID
    },
    "userSettings": {
        "sendSPP": true,           // Toggle sending SPP
        "receiveSPP": false,       // Toggle receiving SPP
        "sppInterval": 4,
        "masterMode": true   // true = Mixxx is master, false = slave
    },
    // Channel variables (4 decks)
    "[Channel1]": {
        connBeatIndicator: {},
    },
    "[Channel2]": {
        connBeatIndicator: {},
    },
    "[Channel3]": {
        connBeatIndicator: {},
    },
    "[Channel4]": {
        connBeatIndicator: {},
    },
};

RegrooveMeister.init = function(id, debug) {
    RegrooveMeister.id = id;
    RegrooveMeister.debug = debug;
    RegrooveMeister.devicePrint("RegrooveMeister init: " + id + ", debug " + debug);

    // Connect beat indicators for all 4 decks
    RegrooveMeister["[Channel1]"].connBeatIndicator = engine.makeConnection("[Channel1]", "beat_active", RegrooveMeister.onBeat);
    RegrooveMeister["[Channel2]"].connBeatIndicator = engine.makeConnection("[Channel2]", "beat_active", RegrooveMeister.onBeat);
    RegrooveMeister["[Channel3]"].connBeatIndicator = engine.makeConnection("[Channel3]", "beat_active", RegrooveMeister.onBeat);
    RegrooveMeister["[Channel4]"].connBeatIndicator = engine.makeConnection("[Channel4]", "beat_active", RegrooveMeister.onBeat);
};

RegrooveMeister.shutdown = function() {
    RegrooveMeister.devicePrint("Regroove Meister shut down.");
    RegrooveMeister["[Channel1]"].connBeatIndicator.disconnect();
    RegrooveMeister["[Channel2]"].connBeatIndicator.disconnect();
    RegrooveMeister["[Channel3]"].connBeatIndicator.disconnect();
    RegrooveMeister["[Channel4]"].connBeatIndicator.disconnect();
};

RegrooveMeister.onBeat = function(value, group, _control) {
    if (!RegrooveMeister["userSettings"].sendSPP) {
        RegrooveMeister.devicePrint("Regroove Meister: sending disabled");
        return;
    }

    if (value) {
        var channel = "[Channel1]"
        var fader = engine.getParameter("[Master]", "crossfader");
        if (fader > 0.5) {
            if (group === "[Channel2]") {
                channel = "[Channel2]"
            }
        }

        // Check if channel is playing
        var isPlaying = engine.getValue(channel, "play");
        if (!isPlaying) {
            RegrooveMeister.devicePrint("Track stopped - not sending SPP");
            return; // Exit early if not playing
        }

        // Calculate position
        var duration = engine.getValue(channel, "duration");
        var playposition = engine.getValue(channel, "playposition");
        var posSec = duration * playposition;
        var bpm = engine.getValue(channel, "bpm");
        var beats = Math.floor(posSec * bpm / 60) * 4;  // not sure WHY it need to double this at least!

         // Auto-nudge to nearest even position
        var alignedBeats = Math.round(beats / 2) * 2;
        
        RegrooveMeister.devicePrint("onbeat: Raw " + beats + " -> Aligned " + alignedBeats);
        
        // Send only at bar boundaries
        if ((alignedBeats % RegrooveMeister["userSettings"].sppInterval) === 0) {
            var sppUnits = alignedBeats
            RegrooveMeister.devicePrint("onbeat send " + sppUnits);
            RegrooveMeister.sendSPP(sppUnits);
        }
    }
};

RegrooveMeister.sendSPP = function(position) {
    var lsb = position & 0x7F;
    var msb = (position >> 7) & 0x7F;

    RegrooveMeister.devicePrint("Sending SPP: position=" + position + ", bytes=[" + lsb + "," + msb + "]");

    controller.sendShortMsg(0xF2, lsb, msb);
};

// Custom print function for this device
RegrooveMeister.devicePrint = function(message) {
    var deviceName = RegrooveMeister.Name;
    var deviceId = "0x" + RegrooveMeister["deviceSettings"].deviceId.toString(16).toUpperCase().padStart(2, '0');

    print("[" + deviceName + " " + deviceId + "]: " + message);
};

// SysEx message handler (called by Mixxx when SysEx messages are received)
RegrooveMeister.incomingData = function(data, length) {
    // Validate SysEx structure
    if (length < 5) {
        RegrooveMeister.devicePrint("SysEx too short: " + length + " bytes");
        return;
    }

    // Check SysEx start (0xF0), manufacturer ID (0x7D), and device ID
    if (data[0] !== 0xF0) {
        RegrooveMeister.devicePrint("Not a SysEx message (start byte: 0x" + data[0].toString(16) + ")");
        return;
    }

    if (data[1] !== 0x7D) {
        RegrooveMeister.devicePrint("Wrong manufacturer ID: 0x" + data[1].toString(16) + " (expected 0x7D)");
        return;
    }

    if (data[2] !== RegrooveMeister.deviceSettings.deviceId) {
        RegrooveMeister.devicePrint("Wrong device ID: 0x" + data[2].toString(16) + " (expected 0x" + RegrooveMeister.deviceSettings.deviceId.toString(16) + ")");
        return;
    }

    // Extract command byte
    var command = data[3];

    RegrooveMeister.devicePrint("Received SysEx command: 0x" + command.toString(16).toUpperCase());

    // Handle commands
    switch (command) {
        case 0x66:  // GET_DECKS_STATE
            RegrooveMeister.devicePrint("GET_DECKS_STATE request received");
            RegrooveMeister.sendDeckState();
            break;

        default:
            RegrooveMeister.devicePrint("Unknown SysEx command: 0x" + command.toString(16).toUpperCase());
            break;
    }
};

// Send deck state for all 4 decks (DECKS_STATE_RESPONSE 0x67)
// Message format: F0 7D <dev> 67 <52 bytes deck state> <4 bytes master> F7
// Total: 61 bytes (4 header + 52 deck data + 4 master + 1 end)
// Each deck: 13 bytes (flags, fx, bpm_msb, bpm_lsb, bpm_frac, volume, pos_msb, pos_lsb, rate, duration, eq_high, eq_mid, eq_low)
RegrooveMeister.sendDeckState = function() {
    var msg = [0xF0, 0x7D, RegrooveMeister.deviceSettings.deviceId, 0x67];

    // Build deck state for all 4 decks (13 bytes each)
    for (var i = 1; i <= 4; i++) {
        var channel = "[Channel" + i + "]";

        // Flags byte
        var flags = 0;
        if (engine.getValue(channel, "play")) flags |= 0x01;              // Bit 0: Playing
        if (engine.getValue(channel, "loop_enabled")) flags |= 0x02;      // Bit 1: Looping
        if (engine.getValue(channel, "sync_enabled")) flags |= 0x04;      // Bit 2: Sync
        if (engine.getValue(channel, "cue_indicator")) flags |= 0x08;     // Bit 3: Cue
        if (engine.getValue(channel, "pfl")) flags |= 0x10;               // Bit 4: PFL (headphone cue)
        if (engine.getValue(channel, "mute")) flags |= 0x20;              // Bit 5: Mute
        msg.push(flags);

        // FX byte (4 effect units, bits 0-3)
        var fx = 0;
        if (engine.getValue("[EffectRack1_EffectUnit1]", "group_" + channel + "_enable")) fx |= 0x01; // Bit 0: FX Unit 1
        if (engine.getValue("[EffectRack1_EffectUnit2]", "group_" + channel + "_enable")) fx |= 0x02; // Bit 1: FX Unit 2
        if (engine.getValue("[EffectRack1_EffectUnit3]", "group_" + channel + "_enable")) fx |= 0x04; // Bit 2: FX Unit 3
        if (engine.getValue("[EffectRack1_EffectUnit4]", "group_" + channel + "_enable")) fx |= 0x08; // Bit 3: FX Unit 4
        msg.push(fx);

        // BPM (split into MSB, LSB, fractional parts - 3 bytes total for 0-16383.99 BPM)
        var bpm = engine.getValue(channel, "bpm") || 0;
        var bpmInt = Math.floor(bpm);
        var bpmFrac = Math.round((bpm - bpmInt) * 100);
        var bpmMsb = (bpmInt >> 7) & 0x7F;  // High 7 bits
        var bpmLsb = bpmInt & 0x7F;          // Low 7 bits
        msg.push(bpmMsb);
        msg.push(bpmLsb);
        msg.push(bpmFrac & 0x7F);

        // Volume (0-127) - use getParameter to get linear fader position (not curved value)
        var volume = Math.round(engine.getParameter(channel, "volume") * 127);
        msg.push(volume & 0x7F);

        // Position (0-16383 mapped from 0.0-1.0)
        var position = engine.getValue(channel, "playposition") || 0;
        var posValue = Math.round(position * 16383);
        var posMsb = (posValue >> 7) & 0x7F;
        var posLsb = posValue & 0x7F;
        msg.push(posMsb);
        msg.push(posLsb);

        // Rate (pitch adjustment: -1.0 to +1.0 mapped to 0-127, center at 64)
        var rate = engine.getValue(channel, "rate") || 0;
        var rateValue = Math.round((rate + 1.0) * 63.5);
        msg.push(rateValue & 0x7F);

        // Duration in 10-second increments (0-127 = 0 to 1270 seconds / 21 minutes)
        var duration = engine.getValue(channel, "duration") || 0; // Duration in seconds
        var durationValue = Math.min(127, Math.round(duration / 10));
        msg.push(durationValue & 0x7F);

        // EQ values (High, Mid, Low) - mapped from 0.0-1.0 to 0-127
        var eqHigh = Math.round(engine.getParameter("[EqualizerRack1_" + channel + "_Effect1]", "parameter3") * 127);
        var eqMid = Math.round(engine.getParameter("[EqualizerRack1_" + channel + "_Effect1]", "parameter2") * 127);
        var eqLow = Math.round(engine.getParameter("[EqualizerRack1_" + channel + "_Effect1]", "parameter1") * 127);
        msg.push(eqHigh & 0x7F);
        msg.push(eqMid & 0x7F);
        msg.push(eqLow & 0x7F);
    }

    // Master state (4 bytes)
    // Crossfader (-1.0 to 1.0 mapped to 0-127)
    var crossfader = Math.round((engine.getValue("[Master]", "crossfader") + 1) * 63.5);
    msg.push(crossfader & 0x7F);

    // Headphone mix (0.0 to 1.0 mapped to 0-127)
    var headMix = Math.round(engine.getValue("[Master]", "headMix") * 127);
    msg.push(headMix & 0x7F);

    // Reserved bytes
    msg.push(0x00);
    msg.push(0x00);

    // SysEx end
    msg.push(0xF7);

    // Send the message
    midi.sendSysexMsg(msg, msg.length);

    RegrooveMeister.devicePrint("Sent DECKS_STATE_RESPONSE (" + msg.length + " bytes)");
};
