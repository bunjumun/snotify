#pragma once
//
// The order songs play in. The page sorts the card's list with
// String.localeCompare (data/library.js); the box has to walk the same list
// when it moves to the next song on its own, so the rule lives here, apart
// from the card so it can be tested on a laptop.
//
// Case-insensitive, with a case-sensitive tie-break so two names that differ
// only in case still have a fixed order. For the plain names this box stores
// (track_name.h) that matches localeCompare. A name with unusual punctuation
// could order differently; the worst outcome is a different song next, not a
// crash or a repeat, because the box only ever asks "what comes after this".
//
namespace trackorder {

// True when `a` plays before `b`.
bool before(const char* a, const char* b);

}  // namespace trackorder
