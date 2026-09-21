/**
 * React sets this to opt a test environment into `act`. Declared once here
 * rather than in each test file.
 */
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

export {}
