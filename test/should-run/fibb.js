'use strict';
function helper(a, b, n) {
  if (n > 0) {
    return helper(b, a+b, n-1);
  } else {
    return a;
  }
}
function fibb(n) {
  return helper(0, 1, n);
}

fibb(1000);