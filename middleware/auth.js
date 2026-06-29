const jwt = require("jsonwebtoken");

const veryfyToken = (req, res, next) => {
  let token = req.headers.authorization;

  if (!token) {
    return res.status(401).send("access denied");
  }

  token = token.split(" ")[1];

  if (!token || token === "null") {
    return res.status(401).send("access denied");
  }

  try {
    const verifiedUser = jwt.verify(token, "khaerul");
    req.user = verifiedUser;
    next();
  } catch (err) {
    return res.status(401).send("token expired");
  }
};

const checkRole = async (req, res, next) => {
  if (req.user.isAdmin) {
    return next();
  }
  return res.status(401).send("access denied");
};

module.exports = { veryfyToken, checkRole };