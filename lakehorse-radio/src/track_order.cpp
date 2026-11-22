#include "track_order.h"

#include <strings.h>
#include <string.h>

namespace trackorder {

bool before(const char* a, const char* b) {
  const int folded = strcasecmp(a, b);
  if (folded != 0) return folded < 0;
  return strcmp(a, b) < 0;
}

}  // namespace trackorder
