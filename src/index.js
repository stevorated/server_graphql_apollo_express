import path from 'path'
import { ApolloServer } from 'apollo-server-express'
import express from 'express'
import session from 'express-session'
import cookieParser from 'cookie-parser'
import mongoDBStore from 'connect-mongodb-session'
import helmet from 'helmet'
import typeDefs from './typeDefs'
import resolvers from './resolvers'
import { protectedStatic, facebookSignUp } from './auth'
import schemaDirectives from './directives'
import db, { mongoString } from './db'
import passport from 'passport'
import FacebookStrategy from 'passport-facebook'
import { User } from './models'

const {
  MY_DOMAIN,
  NODE_ENV,
  APP_PORT,
  SESSION_DB_COLLECTION,
  SESSION_NAME,
  SESSION_SECRET,
  SESSION_LIFE,
  ASSETS_DIR,
  CLIENT_ADDR,
  APP_ID,
  APP_SECRET,
  MY_PUBLIC_DOMAIN,
  FB_LOGIN_PATH,
  FB_LOGIN_CB_PATH,
  FB_LOGIN_FAIL_PATH,
  FB_SUCCESS_URL
} = process.env

const IN_PROD = NODE_ENV === 'production'
console.log('Production: ', IN_PROD)

const assetsDir = path.join(__dirname, '..', ASSETS_DIR)

const app = express()

app.use(cookieParser(SESSION_NAME))
app.disable('x-powered-by')
const MongoSessionStore = mongoDBStore(session)
const store = new MongoSessionStore({
  uri: mongoString,
  collection: SESSION_DB_COLLECTION
})
store.on('error', function (error) {
  console.log(error)
})
app.set('trust proxy', 1)

app.use(session({
  store,
  name: SESSION_NAME,
  secret: SESSION_SECRET,
  resave: true,
  httpOnly: IN_PROD,
  rolling: true,
  saveUninitialized: false,
  cookie: {
    maxAge: parseInt(SESSION_LIFE),
    sameSite: true,
    secure: false // TODO: bring back IN_PROD
  }
}))

app.use('/api/images', protectedStatic)
app.use('/api/images', express.static(assetsDir))

const server = new ApolloServer({
  typeDefs,
  resolvers,
  schemaDirectives,
  playground: IN_PROD
    ? false
    : {
      settings: {
        'request.credentials': 'same-origin'
      }
    }, // TODO: remember to block playground in prod
  uploads: {
    maxFieldSize: 2000000,
    maxFiles: 10
  },
  context: ({ req, res }) => ({ req, res })
})

const corsOptions = {
  origin: [CLIENT_ADDR],
  credentials: true
  // sameSite: false
}

server.applyMiddleware({
  app,
  path: '/api/graphql',
  cors: corsOptions
})

app.use(helmet())
app.get('/api', (req, res) => {
  res.status(200).send('Ya Alla!!!!!!')
})

// ================================================ FB LOGIN ==============================

passport.use(new FacebookStrategy({
  clientID: APP_ID,
  clientSecret: APP_SECRET,
  callbackURL: `${MY_PUBLIC_DOMAIN}${FB_LOGIN_CB_PATH}`,
  profileFields: ['id', 'name', 'email', 'picture']
},
async (accessToken, refreshToken, profile, cb) => {
  const { id, emails, picture } = profile._json
  const givenName = profile._json.first_name
  const familyName = profile._json.last_name
  const userExists = await User.findOne({ fbId: id })
  console.log(' ====================================== picture:', picture)
  if (!userExists) {
    const dbUser = await User.create({
      fbId: id,
      email: emails[0].value,
      fname: givenName,
      lname: familyName,
      username: `${givenName}${familyName}${Date.now()}`,
      password: id
    })
    if (dbUser) {
      dbUser.token = accessToken
      cb(undefined, dbUser)
    }
  } else {
    userExists.token = accessToken
    cb(undefined, userExists)
  }
  // cb(undefined, profile)
}))

app.use(passport.initialize())

passport.serializeUser(async (user, done) => {
  console.log(' ======= serializeUser: ================ ', user)
  const { _id, name, emails, token } = user
  const { familyName, givenName } = name
  done(null, {
    // id,
    userId: _id,
    familyName,
    givenName,
    email: emails[0].value,
    token
  })
})

app.get(FB_LOGIN_PATH,
  passport.authenticate('facebook', { scope: ['email'] }))

app.get(FB_LOGIN_CB_PATH,
  passport.authenticate('facebook', { failureRedirect: FB_LOGIN_FAIL_PATH }),
  async function (req, res, done) {
    // Successful authentication, redirect home.
    return res.status(302).redirect(FB_SUCCESS_URL)
  })

app.get(FB_LOGIN_FAIL_PATH, (req, res) => {
  return res.status(302).redirect(MY_DOMAIN)
})
// ==================================== END FB LOGIN =====================================

app.listen({ port: APP_PORT }, async () => {
  await db()
  console.log(`🚀 Server ready at ${MY_DOMAIN}:${APP_PORT}${server.graphqlPath}`)
}
)
