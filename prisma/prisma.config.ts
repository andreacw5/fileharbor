const config = {
  datasources: {
    db: {
      url: process.env.DATABASE_URL!,
      directUrl: process.env.DATABASE_URL!,
    },
  },
};

export default config;
