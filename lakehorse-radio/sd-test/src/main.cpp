// SD card bench test for the Lakehorse Radio board.
//
// Proves the four SPI wires and the card format, and nothing else, so a
// failure here points at hardware rather than at player code. The SPI clock
// starts at 4 MHz rather than the library default because breakout boards on
// jumper wires often fail at full speed; a slow mount that works tells us more
// than a fast one that does not.

#include <Arduino.h>
#include <SD.h>
#include <SPI.h>

static const int PIN_SCK  = 18;
static const int PIN_MISO = 19;
static const int PIN_MOSI = 23;
static const int PIN_CS   = 5;

static const char *cardTypeName(uint8_t type) {
  switch (type) {
    case CARD_MMC:  return "MMC";
    case CARD_SD:   return "SDSC";
    case CARD_SDHC: return "SDHC/SDXC";
    default:        return "unknown";
  }
}

void setup() {
  Serial.begin(115200);
  // Give the serial monitor time to attach after the upload resets the board.
  delay(1500);
  Serial.println();
  Serial.println("[sdtest] starting");

  SPI.begin(PIN_SCK, PIN_MISO, PIN_MOSI, PIN_CS);
  if (!SD.begin(PIN_CS, SPI, 4000000)) {
    Serial.println("[sdtest] Mount failed. Check FAT32 format, then the CS (5) and MISO (19) wires.");
    return;
  }

  uint8_t type = SD.cardType();
  if (type == CARD_NONE) {
    Serial.println("[sdtest] No card detected.");
    return;
  }

  Serial.printf("[sdtest] Card type: %s\n", cardTypeName(type));
  Serial.printf("[sdtest] Card size: %llu MB\n", SD.cardSize() / (1024ULL * 1024ULL));
  Serial.printf("[sdtest] Used: %llu MB of %llu MB\n",
                SD.usedBytes() / (1024ULL * 1024ULL),
                SD.totalBytes() / (1024ULL * 1024ULL));

  Serial.println("[sdtest] Root directory:");
  File root = SD.open("/");
  if (!root) {
    Serial.println("[sdtest] Could not open root directory.");
    return;
  }
  int count = 0;
  for (File f = root.openNextFile(); f; f = root.openNextFile()) {
    Serial.printf("  %s%s  %u bytes\n", f.name(), f.isDirectory() ? "/" : "",
                  (unsigned)f.size());
    f.close();
    count++;
  }
  root.close();
  if (count == 0) Serial.println("  (empty)");
  Serial.println("[sdtest] PASS");
}

void loop() {}
