module.exports = (request, options) => {
  const defaultResolver = options.defaultResolver;

  try {
    return defaultResolver(request, options);
  } catch (error) {
    if (request.endsWith('.js') && error && error.code === 'MODULE_NOT_FOUND') {
      const tsRequest = request.replace(/\.js$/, '.ts');
      try {
        return defaultResolver(tsRequest, options);
      } catch {
        throw error;
      }
    }
    throw error;
  }
};
