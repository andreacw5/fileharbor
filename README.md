<p align="center">
  <a href="https://github.com/andreacw5/fileharbor" target="blank"><img src="app_logo.png" width="500" alt="File Harbor App Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

<p align="center">
This project is a small service built with Nest.js dedicated to handling image uploads, such as avatars, post covers, and other assets.
</p>
<p align="center">
    <a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@andreacw5/fileharbor" alt="NPM Version" /></a>
    <a href="https://github.com/andreacw5/fileharbor/blob/main/LICENSE.md" target="_blank"><img alt="GitHub License" src="https://img.shields.io/github/license/andreacw5/fileharbor"></a>
</p>

## Getting Started
Follow these instructions to set up the project on your local machine for development and testing purposes.
- Clone the repository to your local machine: `git clone https://github.com/andreacw5/fileharbor.git`
- Install dependencies: `yarn install`
- Start the application in development: `yarn start:dev`
- Visit `http://localhost:3000` in your browser to use the application.

## Requirements
- [Node.js](https://nodejs.org/en/download/) 20 or higher
- [Yarn](https://yarnpkg.com/en/) 1.10.1 or higher

## Built With
- [Nest.js](https://nestjs.com/) - A progressive Node.js framework for building efficient, reliable and scalable server-side applications.
- [Prisma](https://prisma.io/) - Open source Node.js and TypeScript ORM with a readable data model, automated migrations, type-safety, and auto-completion.

## Installation
```bash
# install dependencies
$ yarn install

# Run the application in development mode
$ yarn run start:dev

# Run the application in production mode
$ yarn run start:prod
```

## Test

```bash
# unit tests
$ yarn run test

# e2e tests
$ yarn run test:e2e

# test coverage
$ yarn run test:cov
```

## Contributing
Contributions are welcome! If you want to contribute to this project, please follow these steps:

- Fork the repository.
- Create a new branch (git checkout -b feature/your-feature).
- Make your changes.
- Commit your changes (git commit -am 'Add new feature').
- Push to the branch (git push origin feature/your-feature).
- Create a new Pull Request.

## Environment Variables
| code         | description                  | default value |
|--------------|------------------------------|---------------|
| DATABASE_URL | database url                 |               |
| APP_PORT     | app port                     | 3000          |
| APP_URL      | app url                      |               |
| CACHE_TTL    | Cache ttl value              | 60            |
| API_KEY      | auth token for CUD Endpoints |               |
| LOGS_TOKEN   | logs token                   |               |

## Logging with Betterstack
This project uses a Pino transporter that sends logs to Betterstack. To enable this feature, set the `LOGS_TOKEN` environment variable to the token provided by Betterstack.

## Authentication
Authentication is based on a single static token stored in the `API_KEY` environment variable. Requests for create/edit/delete URLs require the `X-API-KEY` header with the value of `API_KEY`.

## Versioning
We use [SemVer](http://semver.org/) for versioning. For the versions available, see the [tags on this repository](https://github.com/andreacw5/url-manager-app/releases).

## Author
- [Andrea Tombolato](https://andreatombolato.dev)

## License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details
