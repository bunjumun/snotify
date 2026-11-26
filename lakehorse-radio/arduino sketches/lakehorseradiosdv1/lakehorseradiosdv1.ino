#include <SD.h>
#include <SPI.h>

#define SD_CS 5

void setup() {
  Serial.begin(115200);
  delay(1000);
  SPI.begin(18, 19, 23, SD_CS);  // SCK, MISO, MOSI, CS
  if (!SD.begin(SD_CS, SPI, 4000000)) {
    Serial.println("Mount failed");
    return;
  }
  Serial.printf("Card size: %llu MB\n", SD.cardSize() / (1024 * 1024));
  File root = SD.open("/");
  while (File f = root.openNextFile()) {
    Serial.printf("%s  %u bytes\n", f.name(), (unsigned)f.size());
  }
}

void loop() {}
