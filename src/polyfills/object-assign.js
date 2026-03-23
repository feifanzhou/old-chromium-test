if (typeof Object.assign !== "function") {
  Object.assign = function assign(target) {
    if (target == null) {
      throw new TypeError("Cannot convert undefined or null to object");
    }

    var to = Object(target);
    for (var index = 1; index < arguments.length; index += 1) {
      var source = arguments[index];
      if (source == null) {
        continue;
      }

      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          to[key] = source[key];
        }
      }
    }

    return to;
  };
}
