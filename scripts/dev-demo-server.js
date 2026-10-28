// LOCAL DEMO ONLY (Task O): the synthetic dev server with demo sign-in on, so
// the team can sign in as different synthetic people. Same guards as
// dev-synthetic-server.js: refuses to start unless NODE_ENV=development.
//
//   npm run dev:demo     then open http://127.0.0.1:3000/demo/
process.env.QCH_DEMO_SIGN_IN = 'true';
await import('./dev-synthetic-server.js');
