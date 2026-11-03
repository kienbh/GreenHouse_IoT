#pragma once
// Tần số nốt nhạc (Hz)
#define C4 262
#define D4 294
#define E4 330
#define F4 349
#define G4 392
#define A4 440
#define AS4 466
#define B4 494
#define C5 523
#define D5 587
#define E5 659
#define F5 698
#define G5 784
#define R 0     // lặng

struct Note { uint16_t freq; uint16_t ms; };

const Note HAPPY_BIRTHDAY[] = {
  {G4,300},{G4,150},{A4,450},{G4,450},{C5,450},{B4,900},
  {G4,300},{G4,150},{A4,450},{G4,450},{D5,450},{C5,900},
  {G4,300},{G4,150},{G5,450},{E5,450},{C5,450},{B4,450},{A4,900},
  {F5,300},{F5,150},{E5,450},{C5,450},{D5,450},{C5,900},
};

const Note TWINKLE[] = {
  {C4,400},{C4,400},{G4,400},{G4,400},{A4,400},{A4,400},{G4,800},
  {F4,400},{F4,400},{E4,400},{E4,400},{D4,400},{D4,400},{C4,800},
  {G4,400},{G4,400},{F4,400},{F4,400},{E4,400},{E4,400},{D4,800},
  {G4,400},{G4,400},{F4,400},{F4,400},{E4,400},{E4,400},{D4,800},
  {C4,400},{C4,400},{G4,400},{G4,400},{A4,400},{A4,400},{G4,800},
  {F4,400},{F4,400},{E4,400},{E4,400},{D4,400},{D4,400},{C4,800},
};

const Note JINGLE_BELLS[] = {
  {E5,250},{E5,250},{E5,500},{E5,250},{E5,250},{E5,500},
  {E5,250},{G5,250},{C5,375},{D5,125},{E5,1000},
  {F5,250},{F5,250},{F5,375},{F5,125},{F5,250},{E5,250},{E5,250},{E5,125},{E5,125},
  {E5,250},{D5,250},{D5,250},{E5,250},{D5,500},{G5,500},
};

const Note BEEP[] = { {C5,120},{R,60},{G5,180} };

struct Song { const char *name; const Note *notes; int len; };
#define LEN(a) (int)(sizeof(a) / sizeof(a[0]))

// Bài cuối cùng là tiếng bíp khởi động
const Song SONGS[] = {
  {"Happy Birthday", HAPPY_BIRTHDAY, LEN(HAPPY_BIRTHDAY)},
  {"Twinkle Twinkle", TWINKLE, LEN(TWINKLE)},
  {"Jingle Bells", JINGLE_BELLS, LEN(JINGLE_BELLS)},
  {"Bíp", BEEP, LEN(BEEP)},
};
const int SONG_COUNT = LEN(SONGS);
