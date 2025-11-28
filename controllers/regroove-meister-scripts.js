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
    // Channel1 variable
    "[Channel1]": {
        volume: 0,
        connBeatIndicator: {},
    },
    // Channel2 variable
    "[Channel2]": {
        volume: 0,
        connBeatIndicator: {},
    },
};

RegrooveMeister.init = function(id, debug) {    
    RegrooveMeister.id = id;
    RegrooveMeister.debug = debug;
    RegrooveMeister.devicePrint("RegrooveMeister init: " + id + ", debug " + debug);

    RegrooveMeister["[Channel1]"].connBeatIndicator = engine.makeConnection("[Channel1]", "beat_active", RegrooveMeister.onBeat);
    RegrooveMeister["[Channel2]"].connBeatIndicator = engine.makeConnection("[Channel2]", "beat_active", RegrooveMeister.onBeat);
};

RegrooveMeister.shutdown = function() {
    RegrooveMeister.devicePrint("Regroove Meister shut down.");
    RegrooveMeister["[Channel1]"].connBeatIndicator.disconnect();
    RegrooveMeister["[Channel2]"].connBeatIndicator.disconnect();
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
