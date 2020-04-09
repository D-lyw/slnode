module.exports = function NullLogger() {
    this.logStage = function() {}
    this.logApiCall = function() {}
}