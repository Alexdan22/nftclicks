//jshint esversion:6
require('dotenv').config()
const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const mongoose = require('mongoose');
const encrypt = require("mongoose-encryption");
const cookieParser = require("cookie-parser");
const session = require('express-session');
const Razorpay = require('razorpay');
const multer = require('multer');
const path = require('path');
const schedule = require('node-schedule');
const { DateTime } = require('luxon');
const QRCode = require('qrcode');



const app = express();


app.set('view engine', 'ejs');

app.use(bodyParser.urlencoded({
  extended: true
}));

app.use(bodyParser.json());

app.use(express.static("public"));

app.use(cookieParser());

app.use(session({
    secret: process.env.RANDOM,
    saveUninitialized:false,
    resave: false
}));
mongoose.set('strictQuery', false);

//
mongoose.connect("mongodb://localhost:27017/infinityDB");
// mongoose.connect("mongodb+srv://rajeshraja:Admin-12345@cluster0.iokyo.mongodb.net/InfiniteDB", {useNewUrlParser: true});

const adminSchema = new mongoose.Schema({
  email: String,
  withdrawals: [{
    name: String,
    accountNumber: String,
    email: String,
    ifsc: String,
    amount: String,
    bankName: String,
    date: String,
    payment_id: String,
    from: String
  }]
});
const earningsSchema = new mongoose.Schema({
  total: Number,
  available: Number,
  referral: Number,
  today: Number,
});
const bankSchema = new mongoose.Schema({
  accountNumber: Number,
  name: String,
  bankName: String,
  ifsc: String,
  mobile: Number
})
const historySchema = new mongoose.Schema({
  amount: Number,
  time: String,
  status: String,
  payment_id: String
});
const transSchema = new mongoose.Schema({
  type: String,
  amount: Number,
  level: String
});
const userSchema = new mongoose.Schema({
  username: String,
  email: String,
  password: String,
  sponsorID: String,
  inviteCode: String,
  earnings: earningsSchema,
  time: String,
  status: String,
  history: [historySchema],
  log: [transSchema],
  limit: Number,
  bank: bankSchema

});
const paymentSchema = new mongoose.Schema({
  payment_id: String,
  status: String,
  amount: Number,
  vpa: String,
  rrn: String,
  token: String
});
const qrDataSchema = new mongoose.Schema({ text: String });


userSchema.plugin(encrypt, {secret:process.env.SECRET, encryptedFields: ['password'] });

const User = new mongoose.model("User", userSchema);

const Payment = new mongoose.model("Payment", paymentSchema);

const Admin = new mongoose.model("Admin", adminSchema);

const Data = new mongoose.model('Data', qrDataSchema);
// Storage config
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true); // Accept the file
  } else {
    cb(new Error('Only image files are allowed!'), false); // Reject the file
  }
};



// Max file limit = 5
const upload = multer({
  storage,
  fileFilter,
  limits: { files: 5 } // 👈 set max number of files here
});

// Upload multiple images route
app.post('/upload-multiple', upload.array('images', 5), async (req, res) => {
  try {
    const user = await User.findOne({email: req.session.user.email});

    if (!user) {
      return res.status(404).json({
        alertType: 'danger',
        alert: 'true', 
        message: 'User not found' 
      });
    }

    if (user.limit <= 0) {
      return res.status(400).json({
        alertType: 'danger',
        alert: 'true', 
        message: 'Upload limit reached for today. Try again tomorrow.' 
      });
    }

    const filesUploaded = req.files.length;

    if (filesUploaded > user.limit) {
      return res.status(400).json({ 
        alertType: 'danger',
        alert: 'true',
        message: `You can only upload ${user.limit} more images today.` 
      });
    }

    // [Optional] Save file info if needed

    // Decrease the user's limit
    user.limit -= filesUploaded;
    user.earnings.today += filesUploaded;
    user.earnings.available += filesUploaded;
    user.earnings.total += filesUploaded;
    await user.save();

    res.status(200).json({ 
      alertType: 'success',
      alert: 'true',
      message: 'Upload successful!',
      remainingLimit: user.limit
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      alertType: 'danger',
      alert: 'true', 
      message: 'Server error during upload' });
  }
});


app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


//Daily reset 
//Automated Functions
var job = schedule.scheduleJob('0 1 * * *', async (scheduledTime) => {
  const timeZone = 'Asia/Kolkata';
  const currentTimeInTimeZone = DateTime.now().setZone(timeZone);

  try {
    console.log('Resetting daily upload limits at', currentTimeInTimeZone.toISO());

    const users = await User.find();

    for (const user of users) {
      if (user.status === 'Premium') {
        user.limit = 15;
        user.earnings.today = 0;
      } else {
        user.limit = 5;
        user.earnings.today = 0;
      }
      await user.save();
    }

    console.log('All user limits have been reset.');

  } catch (err) {
    console.error('Error resetting limits:', err);
  }
});



//GET ROUTES

app.get("/", function(req, res){
  if(!req.session.user){
    res.redirect("/sign-in");
  }else{
    User.findOne({email: req.session.user.email}, function(err, foundUser){
      res.render("home", {user: foundUser});
    })
  }
});

app.get("/sign-up", function(req, res){
  res.render("sign-up");
});

app.get("/sign-in", function(req, res){
  res.render("sign-in");
});

app.get("/profile", function(req, res){
  if(!req.session.user){
    res.redirect("/sign-in");
  }else{
    User.findOne({email: req.session.user.email}, function(err, foundUser){
      res.render("profile", {user: foundUser});
    })
  }
});

app.get("/settings", function(req, res){
  if(!req.session.user){
    res.redirect("/sign-in");
  }else{
    User.findOne({email: req.session.user.email}, function(err, foundUser){
      User.find({inviteCode: req.session.user.sponsorID}, function(error, users){
        if(!foundUser.bank){
          if(users.length === 0){
            res.render("settings", {user: foundUser});
          }else{
            res.render("settings", {user: foundUser, downlines: users})
          }
        }else{
          if(users.length === 0){
            res.render("settings", {user: foundUser, bank: foundUser.bank});
          }else{
            res.render("settings", {user: foundUser, downlines: users, bank: foundUser.bank})
          }
        }
      });
    });
  }
});

app.get('/withdraw', function(req, res){
  if(!req.session.user){
    res.redirect("/sign-in");
  }else{
    User.findOne({email: req.session.user.email}, function(err, foundUser){
      if(err){
        console.log(err);
      }else{
        if(foundUser.bank){
            res.render("withdraw", {user: foundUser, bank: foundUser.bank});
        }else{
            res.render("withdraw", {user: foundUser});
        }
      }

    });
  }
});

app.get('/log-out', function(req, res){
  req.session.destroy();
  res.redirect("/sign-in");
});

app.get('/package', function(req, res){
  if(!req.session.user){
    res.redirect('/sign-in');
  }else{
    User.findOne({email: req.session.user.email}, function(err, foundUser){
      if(err){
        console.log(err);
      }else{
        res.render('plan', {user: foundUser});
      }
    });
  }
});

app.get('/history', function(req, res){
  if(!req.session.user){
    res.redirect('/sign-in');
  }else{
    User.findOne({email: req.session.user.email}, function(err, foundUser){
      if(err){
        console.log(err);
      }else{
        if(foundUser.history.length != 0){
          res.render('history', {user:foundUser, transaction:foundUser.history});
        }else{
        res.render('history', {user: foundUser});
        }
      }
    });
  }
});

app.get('/transaction', function(req, res){
  if(!req.session.user){
    res.redirect('/sign-in');
  }else{
    User.findOne({email: req.session.user.email}, function(err, foundUser){
      if(err){
        console.log(err);
      }else{
        if(foundUser.log.length != 0){
          res.render('transaction', {user: foundUser, transaction: foundUser.log});
        }else{
          res.render('transaction', {user: foundUser});
        }
      }
    });
  }
});


app.get('/generateQR', async (req, res) => {
  try {
    // Fetch data from MongoDB
    const amount = Number(req.query.amount);
    
    const data = await Data.findOne();
    if (!data) {
      const qr = new Data({
        text: "dummy@upiId"
      });
      qr.save();
      return res.status(404).send('No data found');
    }
    

    // Generate QR code
    const textToQr = `upi://pay?ver=01&mode=19&pa=${data.text}&pn=YUMEKO&tr=RZPYOlFEyT39ewjePiqrv2&cu=INR&mc=5651&qrMedium=04&tn=PaymenttoYUMEKO&am=1999`;
        QRCode.toDataURL(textToQr, (err, url) => {
          if (err) {
            return res.status(500).send('Error generating QR code');
          }
          res.status(200).send({ url });
        });
  } catch (error) {
    res.status(500).send('Server error');
    console.log(error)
  }
});

app.get('/subscribe', function(req, res){
  if(!req.session.user){
    res.redirect('/sign-in');
  }else{
    User.findOne({email: req.session.user.email}, function(err, foundUser){
      if(err){
        console.log(err);
      }else{
        res.render('payment-portal', {user: foundUser});
      }
    });
  }
});

app.get('/sign-up/:sponID', function(req, res){
  if(req.params.sponID){

    res.render('sign-up', {sponsorID:req.params.sponID})
  }else{
    res.redirect("/sign-up");
  }
});

app.get('/loginAsAdmin', function(req, res){
  res.render('adminLogin');
});

app.get('/imTheAdminAlright', function(req, res){
  if(!req.session.admin){
    res.redirect('/loginAsAdmin');
  }else{
    Admin.findOne({email: req.session.admin.email}, function(err, admin){
      if(err){
        console.log(err);
      }else{
        User.find({}, function(err, users){
          User.find({status: "User"}, function(err, active){
            User.find({status: "Leader"}, function(err, activePro){
              if(admin.withdrawals.length == 0){
                res.render("admin", {total: users.length, users: active.length, leaders: activePro.length });
              }else{
                const withdrawals = admin.withdrawals;
                res.render("admin", {withdrawals, total: users.length, users: active.length, leaders: activePro.length});
              }
            });
          });
        });
      }
    });
  }
});


//POST ROUTES

app.post("/sign-up", function(req, res){
  let sponsorID = "NFT" + String(Math.floor(Math.random()*99999));
  let d = new Date();
  let year = d.getFullYear();
  let month = d.getMonth() + 1;
  let date = d.getDate();
  const newUser = new User ({
    username: req.body.username,
    email: req.body.email,
    password: req.body.pass,
    inviteCode: req.body.inviteCode,
    limit: 5,
    earnings: {
      total: 0,
      available: 0,
      referral: 0,
      today: 0

    },
    sponsorID: sponsorID,
    time: date + "/" + month + "/" + year,
    status: "Free"

  });

  // Unique sponsorID
  User.findOne({sponID: sponsorID}, function(err, foundUser){
    if(err){
      console.log(err);
    } else{
      if(foundUser){
        sponsorID = "NFT" + String(Math.floor(Math.random()*99999));
      }
    }
  });

  // User Validation

  User.findOne({email: req.body.email}, function(err, foundUser){
    if(err){
      console.log(err);
    }else{
      if(foundUser){
        if(foundUser.email === req.body.email){
          // Email Validation
          res.render("sign-up", {alert:[{message: 'Email already exist, please sign in', alert: 'warning'}]});
        }
      } else{
        if(req.body.pass !== req.body.rePass){
          // Password Validation
          res.render("sign-up", {alert:[{message: 'Password did not match, please try again', alert: 'warning'}]});
        }else{
          // Process User
          newUser.save();
          res.render("sign-in", {alert:[{message: 'Sign up Successfull, Welcome ' + req.body.username, alert: 'success'}]});
        }
      }
    }
  });


});

app.post("/sign-in", function(req, res){
  User.findOne({email: req.body.email}, function(err, foundUser){
    if(err){
      console.log(err);
    }else{
      if(!foundUser){
        // Email Validation
        res.render("sign-in", {alert:[{message: 'Email does not exist, please sign up first', alert: 'warning'}]});
      }else{
        if(req.body.pass !== foundUser.password){
          //Password Validation
          res.render("sign-in", {alert:[{message: 'Password incorrect, please try again', alert: 'warning'}]});
        }else{
          const user = {
           email: foundUser.email,
           inviteCode: foundUser.inviteCode,
           sponsorID: foundUser.sponsorID
         };
           req.session.user = user;
           res.redirect("/");
        }
      }
    }
  })
});

app.post("/api/bankDetails", async function(req, res) {
  if (!req.session.user) {
    return res.status(200).send({ redirect: true });
  }
  const foundUser = await User.findOne({ email: req.session.user.email });

  const bankDetails = {
    name: req.body.holdersName,
    accountNumber: req.body.accountNumber,
    bankName: req.body.bankName,
    ifsc: req.body.ifsc,
    mobile: req.body.mobile
  };
  if(req.body.mobile.length != 10){
    return res.status(200).send({
      alertType: "danger",
      alert: "true",
      message: "Mobile number must be 10 digits"
    });
  }
  if (req.body.accountNumber !== req.body.reAccountNumber) {
    return res.status(200).send({
      alertType: "danger",
      alert: "true",
      message: "Account number mismatch, please try again"
    });
  }

  try {
    await User.updateOne(
      { email: foundUser.email },
      { $set: { bank: bankDetails } }
    );


    res.status(200).send({
      alertType: "success",
      alert: "true",
      bank: bankDetails,
      message: "Bank details updated successfully"
    });
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Failed to update or retrieve bank details" });
  }
});


app.post('/log-out', function(req, res){
  req.session.destroy();
  res.redirect("/sign-in");
});

app.post('/withdraw', function(req, res){
  let d = new Date();
  let year = d.getFullYear();
  let month = d.getMonth() + 1;
  let date = d.getDate();
  let hour = d.getHours() ;
  let minutes = d.getMinutes();
  const currentTime = hour + ":" + minutes;
  const currentDate =  date + "/" + month + "/" + year;

  User.findOne({email: req.session.user.email}, function(err, foundUser){
    User.find({inviteCode: foundUser.sponsorID}, function(error, users){
      const activeUsers = [];
      const amt = Number(req.body.amount);
      users.forEach(function(user){
        if(user.status != 'None'){
          activeUsers.push(user);
        }
      });
      if(activeUsers.length != 0){
        //Has one referral
        if(!foundUser.bank){
          //No bank account
          res.render("withdraw", {user: foundUser,  alert:{alertType:'danger', alert:'Please update bank details for withdrawal'}});
        }else{
          if(amt<2){
            //Less than withdrawal limit
            if(foundUser.bank){
                res.render("withdraw", {user: foundUser, bank: foundUser.bank, alert:{alertType:'warning', alert:'Entered amount is below minimum withdrawal'}});
            }else{
                res.render("withdraw", {user: foundUser,  alert:{alertType:'warning', alert:'Entered amount is below minimum withdrawal'}});
            }
          }else{
            if(amt>foundUser.earnings.available){
              //Entered amount is more than available balance
              if(foundUser.bank){
                  res.render("withdraw", {user: foundUser, bank: foundUser.bank, alert:{alertType:'warning', alert:'Low balance, please enter valid amount'}});
              }else{
                  res.render("withdraw", {user: foundUser,  alert:{alertType:'warning', alert:'Low balance, please enter valid amount'}});
              }
            }else{
              //process req
              const newValue = {
                total: foundUser.earnings.total,
                available: foundUser.earnings.available - amt,
                referral: foundUser.earnings.referral,
                level: foundUser.earnings.level,
                team: foundUser.earnings.team,
                autobot: foundUser.earnings.autobot
              }
              // updating available balance
              User.updateOne({email:foundUser.email}, {$set:{earnings:newValue }}, function(err){
                if(err){
                  console.log(err);
                }
              });
              // History update
              const random = "INF" + String(Math.floor(Math.random()*999999999999));
              const history = foundUser.history;
              const newHistory = {
                status: "pending",
                amount: req.body.amount,
                time: date + "/" + month,
                payment_id: random
              };
              history.push(newHistory);
              User.updateOne({email:foundUser.email}, {$set:{history:history}}, function(err){
                if(err){
                  console.log(err);
                }
              });
              // Transaction update
              const transactions = foundUser.log;
              const newTransaction = {
                type: 'withdrawal',
                amount: amt,
                level: 'Wallet'
              };
              transactions.push(newTransaction);
              User.updateOne({email:foundUser.email}, {$set:{log:transactions}}, function(err){
                if(err){
                  console.log(err);
                }
              });
              // Admin panel requests
              Admin.findOne({email: process.env.EMAIL}, function(err, admin){
                if(err){
                  console.log(err);
                }else{
                  if(admin.withdrawals){
                    const withdrawal = admin.withdrawals;
                    const newWithdraw = {
                      name: foundUser.bank.name,
                      email: foundUser.email,
                      accountNumber: foundUser.bank.accountNumber,
                      ifsc: foundUser.bank.ifsc,
                      amount: req.body.amount,
                      bankName: foundUser.bank.bankName,
                      date: date + '/' + month,
                      payment_id: random
                    }
                    withdrawal.push(newWithdraw);
                    Admin.updateOne({email: process.env.EMAIL}, {$set:{withdrawals:withdrawal}}, function(err){
                      if(err){
                        console.log(err);
                      }
                    });

                  }else{

                    const newWithdraw = {
                      name: foundUser.bank.name,
                      email: foundUser.email,
                      accountNumber: foundUser.bank.accountNumber,
                      ifsc: foundUser.bank.ifsc,
                      amount: req.body.amount,
                      bankName: foundUser.bank.bankName,
                      date: date + '/' + month
                    }
                    Admin.updateOne({email: process.env.EMAIL}, {$set:{withdrawals:newWithdraw}}, function(err){
                      if(err){
                        console.log(err);
                      }
                    });
                  }
                }
              });
              User.findOne({email: foundUser.email}, function(err, updatedUser){
                if(foundUser.bank){
                    res.render("withdraw", {user: updatedUser, bank: foundUser.bank, alert:{alertType:'success', alert:'Withdraw success'}});
                }else{
                    res.render("withdraw", {user: updatedUser,  alert:{alertType:'success', alert:'Withdraw success'}});
                }
              });
            }
          }
        }
      }else{
        //One referral must
        if(foundUser.bank){
            res.render("withdraw", {user: foundUser, bank: foundUser.bank, alert:{alertType:'danger', alert:'One referral required for withdrawal'}});
        }else{
            res.render("withdraw", {user: foundUser,  alert:{alertType:'danger', alert:'One referral required for withdrawal'}});
        }
      }
    });
  });
});

app.post('/activate', function(req, res){
  if(!req.session.user){
    res.redirect('/sign-in');
  }else{
    let d = new Date();
    let year = d.getFullYear();
    let month = d.getMonth() + 1;
    let date = d.getDate();
    let hour = d.getHours() ;
    let minutes = d.getMinutes();
    const updated = date + "/" + month + "/" + year;
      Payment.findOne({rrn: req.body.transaction_id}, function(err, foundPayment){
        if(foundPayment){
          //Process the Payment
          if(foundPayment.token === "Valid"){
            //Check for User Plan
            User.findOne({email: req.session.user.email}, function(err, foundUser){
              if(err){
                console.log(err);
              }else{
                if(foundUser.status === "None"){
                  //Update status
                  User.updateOne({email: foundUser.email}, {$set:{status:'User'}}, function(error){
                    if(error){
                      console.log(error);
                    }
                    else{
                      Payment.updateOne({rrn: req.body.transaction_id}, {$set:{token: "Invalid"}}, function(err){
                        if(err){
                          console.log(err);
                        }
                      });
                    }
                  });
                  User.updateOne({email: req.session.user.email},{$set:{time: updated }}, function(err){
                    if(err){
                      console.log(err);
                    }
                  });

                  //referral
                  User.findOne({sponsorID: foundUser.inviteCode}, function(error, upline){
                    if(upline){
                      if(upline.status != 'None'){
                        const newValue = {
                          total: upline.earnings.total + 10,
                          available: upline.earnings.available + 10,
                          referral: upline.earnings.referral + 10,
                          level: upline.earnings.level,
                          team: upline.earnings.team,
                          autobot: upline.earnings.autobot
                        }
                        // Transaction update
                        const transactions = upline.log;
                        const newTransaction = {
                          type: 'referral',
                          amount: 10,
                          level: 'Direct'
                        };
                        transactions.push(newTransaction);
                        User.updateOne({email:upline.email}, {$set:{log:transactions}}, function(err){
                          if(err){
                            console.log(err);
                          }
                        });
                        //Referral points
                        User.updateOne({email:upline.email}, {$set:{earnings:newValue}}, function(err){
                          if(err){
                            console.log(err);
                          }
                        });
                        //Level Income
                        User.findOne({sponsorID: upline.inviteCode}, function(err, u1){
                          if(u1){
                            if(u1.status != 'None'){
                              //Level 1
                              const u1value = {
                                total: u1.earnings.total + 1,
                                available: u1.earnings.available + 1,
                                referral: u1.earnings.referral,
                                level: u1.earnings.level + 1,
                                team: u1.earnings.team,
                                autobot: u1.earnings.autobot
                              }
                              // Transaction update
                              const u1tran = u1.log;
                              const u1new = {
                                type: 'level',
                                amount: 1,
                                level: 'level 1'
                              };
                              u1tran.push(u1new);
                              User.updateOne({email:u1.email}, {$set:{log:u1tran}}, function(err){
                                if(err){
                                  console.log(err);
                                }
                              });
                              //Referral points
                              User.updateOne({email:u1.email}, {$set:{earnings:u1value}}, function(err){
                                if(err){
                                  console.log(err);
                                }
                              });
                              User.findOne({sponsorID: u1.inviteCode}, function(err, u2){
                                if(u2){
                                  if(u2.status != 'None'){
                                    const u2value = {
                                      total: u2.earnings.total + 1,
                                      available: u2.earnings.available + 1,
                                      referral: u2.earnings.referral,
                                      level: u2.earnings.level + 1,
                                      team: u2.earnings.team,
                                      autobot: u2.earnings.autobot
                                    }
                                    // Transaction update
                                    const u2tran = u2.log;
                                    const u2new = {
                                      type: 'level',
                                      amount: 1,
                                      level: 'level 2'
                                    };
                                    u2tran.push(u2new);
                                    User.updateOne({email:u2.email}, {$set:{log:u2tran}}, function(err){
                                      if(err){
                                        console.log(err);
                                      }
                                    });
                                    //Referral points
                                    User.updateOne({email:u2.email}, {$set:{earnings:u2value}}, function(err){
                                      if(err){
                                        console.log(err);
                                      }
                                    });
                                    //Level 2
                                    User.findOne({sponsorID: u2.inviteCode}, function(err, u3){
                                      if(u3){
                                        if(u3.status != 'None'){
                                          //Level 3
                                          const u3value = {
                                            total: u3.earnings.total + 1,
                                            available: u3.earnings.available + 1,
                                            referral: u3.earnings.referral,
                                            level: u3.earnings.level + 1,
                                            team: u3.earnings.team,
                                            autobot: u3.earnings.autobot
                                          }
                                          // Transaction update
                                          const u3tran = u3.log;
                                          const u3new = {
                                            type: 'level',
                                            amount: 1,
                                            level: 'level 3'
                                          };
                                          u3tran.push(u3new);
                                          User.updateOne({email:u3.email}, {$set:{log:u3tran}}, function(err){
                                            if(err){
                                              console.log(err);
                                            }
                                          });
                                          //Referral points
                                          User.updateOne({email:u3.email}, {$set:{earnings:u3value}}, function(err){
                                            if(err){
                                              console.log(err);
                                            }
                                          });
                                          User.findOne({sponsorID: u3.inviteCode}, function(err, u4){
                                            if(u4){
                                              if(u4.status != 'None'){
                                                //Level 4
                                                const u4value = {
                                                  total: u4.earnings.total + 1,
                                                  available: u4.earnings.available + 1,
                                                  referral: u4.earnings.referral,
                                                  level: u4.earnings.level + 1,
                                                  team: u4.earnings.team,
                                                  autobot: u4.earnings.autobot
                                                }
                                                // Transaction update
                                                const u4tran = u4.log;
                                                const u4new = {
                                                  type: 'level',
                                                  amount: 1,
                                                  level: 'level 4'
                                                };
                                                u4tran.push(u4new);
                                                User.updateOne({email:u4.email}, {$set:{log:u4tran}}, function(err){
                                                  if(err){
                                                    console.log(err);
                                                  }
                                                });
                                                //Referral points
                                                User.updateOne({email:u4.email}, {$set:{earnings:u4value}}, function(err){
                                                  if(err){
                                                    console.log(err);
                                                  }
                                                });
                                                User.findOne({sponsorID: u4.inviteCode}, function(err, u5){
                                                  if(u5){
                                                    if(u5.status != 'None'){
                                                      //Level 5
                                                      const u5value = {
                                                        total: u5.earnings.total + 1,
                                                        available: u5.earnings.available + 1,
                                                        referral: u5.earnings.referral,
                                                        level: u5.earnings.level + 1,
                                                        team: u5.earnings.team,
                                                        autobot: u5.earnings.autobot
                                                      }
                                                      // Transaction update
                                                      const u5tran = u5.log;
                                                      const u5new = {
                                                        type: 'level',
                                                        amount: 1,
                                                        level: 'level 5'
                                                      };
                                                      u5tran.push(u5new);
                                                      User.updateOne({email:u5.email}, {$set:{log:u5tran}}, function(err){
                                                        if(err){
                                                          console.log(err);
                                                        }
                                                      });
                                                      //Referral points
                                                      User.updateOne({email:u5.email}, {$set:{earnings:u5value}}, function(err){
                                                        if(err){
                                                          console.log(err);
                                                        }
                                                      });
                                                      User.findOne({sponsorID: u5.inviteCode}, function(err, u6){
                                                        if(u6){
                                                          if(u6.status != 'None'){
                                                            //Level 6
                                                            const u6value = {
                                                              total: u6.earnings.total + 1,
                                                              available: u6.earnings.available + 1,
                                                              referral: u6.earnings.referral,
                                                              level: u6.earnings.level + 1,
                                                              team: u6.earnings.team,
                                                              autobot: u6.earnings.autobot
                                                            }
                                                            // Transaction update
                                                            const u6tran = u6.log;
                                                            const u6new = {
                                                              type: 'level',
                                                              amount: 1,
                                                              level: 'level 6'
                                                            };
                                                            u6tran.push(u6new);
                                                            User.updateOne({email:u6.email}, {$set:{log:u6tran}}, function(err){
                                                              if(err){
                                                                console.log(err);
                                                              }
                                                            });
                                                            //Referral points
                                                            User.updateOne({email:u6.email}, {$set:{earnings:u6value}}, function(err){
                                                              if(err){
                                                                console.log(err);
                                                              }
                                                            });
                                                            User.findOne({sponsorID: u6.inviteCode}, function(err, u7){
                                                              if(u7){
                                                                if(u7.status != 'None'){
                                                                  //Level 7
                                                                  const u7value = {
                                                                    total: u7.earnings.total + 1,
                                                                    available: u7.earnings.available + 1,
                                                                    referral: u7.earnings.referral,
                                                                    level: u7.earnings.level + 1,
                                                                    team: u7.earnings.team,
                                                                    autobot: u7.earnings.autobot
                                                                  }
                                                                  // Transaction update
                                                                  const u7tran = u7.log;
                                                                  const u7new = {
                                                                    type: 'level',
                                                                    amount: 1,
                                                                    level: 'level 7'
                                                                  };
                                                                  u7tran.push(u7new);
                                                                  User.updateOne({email:u7.email}, {$set:{log:u7tran}}, function(err){
                                                                    if(err){
                                                                      console.log(err);
                                                                    }
                                                                  });
                                                                  //Referral points
                                                                  User.updateOne({email:u7.email}, {$set:{earnings:u7value}}, function(err){
                                                                    if(err){
                                                                      console.log(err);
                                                                    }
                                                                  });
                                                                  User.findOne({sponsorID: u7.inviteCode}, function(err, u8){
                                                                    if(u8){
                                                                      if(u8.status != 'None'){
                                                                        //Level 8
                                                                        const u8value = {
                                                                          total: u8.earnings.total + 1,
                                                                          available: u8.earnings.available + 1,
                                                                          referral: u8.earnings.referral,
                                                                          level: u8.earnings.level + 1,
                                                                          team: u8.earnings.team,
                                                                          autobot: u8.earnings.autobot
                                                                        }
                                                                        // Transaction update
                                                                        const u8tran = u8.log;
                                                                        const u8new = {
                                                                          type: 'level',
                                                                          amount: 1,
                                                                          level: 'level 8'
                                                                        };
                                                                        u8tran.push(u8new);
                                                                        User.updateOne({email:u8.email}, {$set:{log:u8tran}}, function(err){
                                                                          if(err){
                                                                            console.log(err);
                                                                          }
                                                                        });
                                                                        //Referral points
                                                                        User.updateOne({email:u8.email}, {$set:{earnings:u8value}}, function(err){
                                                                          if(err){
                                                                            console.log(err);
                                                                          }
                                                                        });
                                                                        User.findOne({sponsorID: u8.inviteCode}, function(err, u9){
                                                                          if(u9){
                                                                            if(u9.status != 'None'){
                                                                              //Level 9
                                                                              const u9value = {
                                                                                total: u9.earnings.total + 1,
                                                                                available: u9.earnings.available + 1,
                                                                                referral: u9.earnings.referral,
                                                                                level: u9.earnings.level + 1,
                                                                                team: u9.earnings.team,
                                                                                autobot: u9.earnings.autobot
                                                                              }
                                                                              // Transaction update
                                                                              const u9tran = u9.log;
                                                                              const u9new = {
                                                                                type: 'level',
                                                                                amount: 1,
                                                                                level: 'level 9'
                                                                              };
                                                                              u9tran.push(u9new);
                                                                              User.updateOne({email:u9.email}, {$set:{log:u9tran}}, function(err){
                                                                                if(err){
                                                                                  console.log(err);
                                                                                }
                                                                              });
                                                                              //Referral points
                                                                              User.updateOne({email:u9.email}, {$set:{earnings:u9value}}, function(err){
                                                                                if(err){
                                                                                  console.log(err);
                                                                                }
                                                                              });
                                                                              User.findOne({sponsorID: u9.inviteCode}, function(err, u10){
                                                                                if(u10){
                                                                                  if(u10.status != 'None'){
                                                                                    //Level 10
                                                                                    const u10value = {
                                                                                      total: u10.earnings.total + 1,
                                                                                      available: u10.earnings.available + 1,
                                                                                      referral: u10.earnings.referral,
                                                                                      level: u10.earnings.level + 1,
                                                                                      team: u10.earnings.team,
                                                                                      autobot: u10.earnings.autobot
                                                                                    }
                                                                                    // Transaction update
                                                                                    const u10tran = u10.log;
                                                                                    const u10new = {
                                                                                      type: 'level',
                                                                                      amount: 1,
                                                                                      level: 'level 10'
                                                                                    };
                                                                                    u10tran.push(u10new);
                                                                                    User.updateOne({email:u10.email}, {$set:{log:u10tran}}, function(err){
                                                                                      if(err){
                                                                                        console.log(err);
                                                                                      }
                                                                                    });
                                                                                    //Referral points
                                                                                    User.updateOne({email:u10.email}, {$set:{earnings:u10value}}, function(err){
                                                                                      if(err){
                                                                                        console.log(err);
                                                                                      }
                                                                                    });

                                                                                  }
                                                                                }
                                                                              })
                                                                            }
                                                                          }
                                                                        });
                                                                      }
                                                                    }
                                                                  });
                                                                }
                                                              }
                                                            });
                                                          }
                                                        }
                                                      });
                                                    }
                                                  }
                                                });
                                              }
                                            }
                                          });
                                        }
                                      }
                                    });
                                  }
                                }
                              });
                            }
                          }
                        });
                      }
                    }
                  });

                  res.render('payment-portal', {user: foundUser, alert:{alertType:'success', alert:'ID activation Successfull.'}});
                }else{
                  //For Upgrade Plan
                  if(foundPayment.amount !== 3200){
                    User.updateOne({email: req.session.user.email},{$set:{status: "Leader"}}, function(err){
                      if(err){
                        console.log(err);
                      }
                      else{
                        Payment.updateOne({rrn: req.body.transaction_id}, {$set:{token: "Invalid"}}, function(err){
                          if(err){
                            console.log(err);
                          }
                        });
                      }
                    });
                    //  Referral points
                    User.findOne({sponsorID: foundUser.inviteCode}, function(error, upline){
                      if(upline){
                        if(upline.status == 'Leader'){
                          const newValue = {
                            total: upline.earnings.total + 20,
                            available: upline.earnings.available + 20,
                            referral: upline.earnings.referral + 20,
                            level: upline.earnings.level,
                            team: upline.earnings.team,
                            autobot: upline.earnings.autobot
                          }
                          // Transaction update
                          const transactions = upline.log;
                          const newTransaction = {
                            type: 'upgrade',
                            amount: 20,
                            level: 'Direct'
                          };
                          transactions.push(newTransaction);
                          User.updateOne({email:upline.email}, {$set:{log:transactions}}, function(err){
                            if(err){
                              console.log(err);
                            }
                          });
                          //Referral points
                          User.updateOne({email:upline.email}, {$set:{earnings:newValue}}, function(err){
                            if(err){
                              console.log(err);
                            }
                          });
                          //Level Income
                          User.findOne({sponsorID: upline.inviteCode}, function(err, u1){
                            if(u1){
                              if(u1.status == 'Leader'){
                                //Level 1
                                const u1value = {
                                  total: u1.earnings.total + 5,
                                  available: u1.earnings.available + 5,
                                  referral: u1.earnings.referral,
                                  level: u1.earnings.level,
                                  team: u1.earnings.team + 5,
                                  autobot: u1.earnings.autobot
                                }
                                // Transaction update
                                const u1tran = u1.log;
                                const u1new = {
                                  type: 'level',
                                  amount: 5,
                                  level: 'level 1'
                                };
                                u1tran.push(u1new);
                                User.updateOne({email:u1.email}, {$set:{log:u1tran}}, function(err){
                                  if(err){
                                    console.log(err);
                                  }
                                });
                                //Referral points
                                User.updateOne({email:u1.email}, {$set:{earnings:u1value}}, function(err){
                                  if(err){
                                    console.log(err);
                                  }
                                });
                                User.findOne({sponsorID: u1.inviteCode}, function(err, u2){
                                  if(u2){
                                    if(u2.status == 'Leader'){
                                      const u2value = {
                                        total: u2.earnings.total + 5,
                                        available: u2.earnings.available + 5,
                                        referral: u2.earnings.referral,
                                        level: u2.earnings.level,
                                        team: u2.earnings.team + 5,
                                        autobot: u2.earnings.autobot
                                      }
                                      // Transaction update
                                      const u2tran = u2.log;
                                      const u2new = {
                                        type: 'level',
                                        amount: 5,
                                        level: 'level 2'
                                      };
                                      u2tran.push(u2new);
                                      User.updateOne({email:u2.email}, {$set:{log:u2tran}}, function(err){
                                        if(err){
                                          console.log(err);
                                        }
                                      });
                                      //Referral points
                                      User.updateOne({email:u2.email}, {$set:{earnings:u2value}}, function(err){
                                        if(err){
                                          console.log(err);
                                        }
                                      });
                                      //Level 2
                                      User.findOne({sponsorID: u2.inviteCode}, function(err, u3){
                                        if(u3){
                                          if(u3.status == 'Leader'){
                                            //Level 3
                                            const u3value = {
                                              total: u3.earnings.total + 5,
                                              available: u3.earnings.available + 5,
                                              referral: u3.earnings.referral,
                                              level: u3.earnings.level,
                                              team: u3.earnings.team + 5,
                                              autobot: u3.earnings.autobot
                                            }
                                            // Transaction update
                                            const u3tran = u3.log;
                                            const u3new = {
                                              type: 'level',
                                              amount: 5,
                                              level: 'level 3'
                                            };
                                            u3tran.push(u3new);
                                            User.updateOne({email:u3.email}, {$set:{log:u3tran}}, function(err){
                                              if(err){
                                                console.log(err);
                                              }
                                            });
                                            //Referral points
                                            User.updateOne({email:u3.email}, {$set:{earnings:u3value}}, function(err){
                                              if(err){
                                                console.log(err);
                                              }
                                            });
                                            User.findOne({sponsorID: u3.inviteCode}, function(err, u4){
                                              if(u4){
                                                if(u4.status == 'Leader'){
                                                  //Level 4
                                                  const u4value = {
                                                    total: u4.earnings.total + 5,
                                                    available: u4.earnings.available + 5,
                                                    referral: u4.earnings.referral,
                                                    level: u4.earnings.level,
                                                    team: u4.earnings.team + 5,
                                                    autobot: u4.earnings.autobot
                                                  }
                                                  // Transaction update
                                                  const u4tran = u4.log;
                                                  const u4new = {
                                                    type: 'level',
                                                    amount: 5,
                                                    level: 'level 4'
                                                  };
                                                  u4tran.push(u4new);
                                                  User.updateOne({email:u4.email}, {$set:{log:u4tran}}, function(err){
                                                    if(err){
                                                      console.log(err);
                                                    }
                                                  });
                                                  //Referral points
                                                  User.updateOne({email:u4.email}, {$set:{earnings:u4value}}, function(err){
                                                    if(err){
                                                      console.log(err);
                                                    }
                                                  });
                                                  User.findOne({sponsorID: u4.inviteCode}, function(err, u5){
                                                    if(u5){
                                                      if(u5.status == 'Leader'){
                                                        //Level 5
                                                        const u5value = {
                                                          total: u5.earnings.total + 5,
                                                          available: u5.earnings.available + 5,
                                                          referral: u5.earnings.referral,
                                                          level: u5.earnings.level,
                                                          team: u5.earnings.team + 5,
                                                          autobot: u5.earnings.autobot
                                                        }
                                                        // Transaction update
                                                        const u5tran = u5.log;
                                                        const u5new = {
                                                          type: 'level',
                                                          amount: 5,
                                                          level: 'level 5'
                                                        };
                                                        u5tran.push(u5new);
                                                        User.updateOne({email:u5.email}, {$set:{log:u5tran}}, function(err){
                                                          if(err){
                                                            console.log(err);
                                                          }
                                                        });
                                                        //Referral points
                                                        User.updateOne({email:u5.email}, {$set:{earnings:u5value}}, function(err){
                                                          if(err){
                                                            console.log(err);
                                                          }
                                                        });
                                                      }
                                                    }
                                                  });
                                                }
                                              }
                                            });
                                          }
                                        }
                                      });
                                    }
                                  }
                                });
                              }
                            }
                          });
                        }
                      }
                    });
                      const alert = "Upgrade Successfull."
                      const alertType = "success"
                      res.render("payment-portal", {alert:{alert, alertType}, user:foundUser});
                  }else{
                    const alert = "Please check the paid amount is 50$"
                    const alertType = "warning"
                    res.render("payment-portal", {alert:{alert, alertType}, user:foundUser});
                  }

                }
              }
            });
          }else{
            //Payment ID already been used
            User.findOne({email:req.session.user.email}, function(err, foundUser){
              if(err){
                console.log(err);
              }else {
                const alert = "Payment ID has already been validated."
                const alertType = "warning"

                res.render("payment-portal", {alert:{alert, alertType}, user:foundUser});

              }
            });
          }
        }else{
          //No transaction ID found
          User.findOne({email:req.session.user.email}, function(err, foundUser){
            if(err){
              console.log(err);
            }else {
              const alert = "Invalid transaction ID"
              const alertType = "danger"

              res.render("payment-portal", {alert:{alert, alertType}, user:foundUser});
            }
          });
        }
      });






  }
});

app.post("/verify", function(req, res){
  const secret = process.env.KEY;
  let signature = req.headers["x-razorpay-signature"];
  let validated_signature = Razorpay.validateWebhookSignature(JSON.stringify(req.body), signature, secret);
  if (validated_signature === true) {
    // process it
    let body = req.body["payload"]["payment"]["entity"]
    const newPayment = new Payment({
      id: body.id,
      status: body.status,
      amount: body.amount/100,
      vpa: body.vpa,
      rrn: body.acquirer_data.rrn,
      token: "Valid"
    });
    newPayment.save();
  }
  res.json({ status: 'ok' })
});

app.post("/adminLogin", function(req, res){
  Admin.findOne({email: req.body.email}, function(err, foundUser){
    if(err){
      console.log(err);
    }else{
      if(foundUser){
        if(process.env.PASS === req.body.pass){
          req.session.admin = {
            email: process.env.EMAIL
          }
            res.redirect("/imTheAdminAlright");
        }else{
          res.redirect("/loginAsAdmin");
        }

      }else{
        res.redirect("/loginAsAdmin");
      }
    }
  });
});

app.post("/user-details", function(req, res){
  if(req.body.email !== 'undefined'){
    User.findOne({email:req.body.email}, function(err, foundUser){
      if(err){
        console.log(err);
      }else {
        if(foundUser){
          const user = {
           email: foundUser.email,
           inviteCode: foundUser.inviteCode,
           sponsorID: foundUser.sponsorID
         };
           req.session.user = user;
           res.redirect("/profile");
        } else{
          if(req.body.sponID !== 'undefined'){
            User.findOne({sponsorID:req.body.sponID}, function(err, foundUser){
              if(err){
                console.log(err);
              }else {
                if(foundUser){
                  const user = {
                   email: foundUser.email,
                   inviteCode: foundUser.inviteCode,
                   sponsorID: foundUser.sponsorID
                 };
                   req.session.user = user;
                   res.redirect("/profile");
                } else{
                  res.redirect("/imTheAdminAlright");
                }
              }
            });
          }else{
          res.redirect("/imTheAdminAlright");
          }
        }
      }
    });
  }else{
    User.findOne({sponsorID:req.body.sponID}, function(err, foundUser){
      if(err){
        console.log(err);
      }else {
        if(foundUser){
          const user = {
           email: foundUser.email,
           inviteCode: foundUser.inviteCode,
           sponsorID: foundUser.sponsorID
         };
           req.session.user = user;
           res.redirect("/dashboard");
        } else{
          res.redirect("/imTheAdminAlright");
        }
      }
    });
  }

});

app.post('/sensitive', function(req, res){
  if(!req.session.admin){
    res.redirect('/imTheAdminAlright');
  }else{
    User.findOne({email: req.body.email}, function(err, foundUser){
      if(err){
        console.log(err);
      }else{
        if(foundUser){
          if(!foundUser.bank){
              res.render("sensitive", {user: foundUser});
          }else{
              res.render("sensitive", {user: foundUser, bank: foundUser.bank});
          }
        }else{
          res.redirect('/imTheAdminAlright')
        }
      }
    })
  }
});

app.post('/global-credit', function(req, res){
  if(!req.session.admin){
    res.redirect('/loginAsAdmin');
  }else{
    User.findOne({email: req.body.email}, function(err, user){
      if(user){
        if(user.status != 'None'){
          const amount = Number(req.body.amount);
          const uservalue = {
            total: user.earnings.total + amount,
            available: user.earnings.available + amount,
            referral: user.earnings.referral,
            level: user.earnings.level ,
            team: user.earnings.team,
            autobot: user.earnings.autobot + amount
          }
          // Transaction update
          const usertran = user.log;
          let level = '-';
          if(amount == 2){
            level = 'level-1'
          }
          if(amount == 4){
            level = 'level-2'
          }
          if(amount == 8 ){
            level = 'level-3'
          }
          if(amount == 16){
            level = 'level-4'
          }
          if(amount == 32){
            level = 'level-5'
          }
          if(amount == 64){
            level = 'level-6'
          }
          if(amount == 128){
            level = 'level-7'
          }
          if(amount == 256){
            level = 'level-8'
          }
          if(amount ==512){
            level = 'level-9'
          }
          if(amount ==1024){
            level = 'level-10'
          }
          const userNew = {
            type: 'global',
            amount: amount,
            level: level
          };
          usertran.push(userNew);
          User.updateOne({email:user.email}, {$set:{log:usertran}}, function(err){
            if(err){
              console.log(err);
            }
          });
          //Referral points
          User.updateOne({email:user.email}, {$set:{earnings:uservalue}}, function(err){
            if(err){
              console.log(err);
            }
          });
          User.find({time: user.time}, function(err, users){
            if(err){
              console.log(err);
            }else{
              let acTive =[];
              users.forEach(function(active){
                if(active.status == 'User' || active.status == 'Leader'){
                  acTive.push(active);
                }
              });
              res.render("credit", {acTive});
            }
          });

        }
      }
    });
  }
});

app.post("/users", function(req, res){
  if(!req.session.admin){
    res.redirect("/loginAsAdmin");
  }else {
    if(req.body.users == 'all'){
      User.find({time: req.body.date}, function(err, users){
        if(err){
          console.log(err);
        }else{
          res.render("credit", {users})
        }
      });
    }else{
      User.find({time: req.body.date}, function(err, users){
        if(err){
          console.log(err);
        }else{
          let acTive =[];
          users.forEach(function(active){
            if(active.status == 'User' || active.status == 'Leader'){
              acTive.push(active);
            }
          });
          res.render("credit", {acTive});
        }
      });
    }
  }
});

app.post("/credit", function(req, res){

  User.findOne({email: req.body.email}, function(err, foundUser){
    if(err){
      console.log(err);
    }else{
      let d = new Date();
      let year = d.getFullYear();
      let month = d.getMonth() + 1;
      let date = d.getDate();
      let hour = d.getHours() ;
      let minutes = d.getMinutes();
      const currentDate =  date + "/" + month + "/" + year;
      if(foundUser){
        const amount = Number(req.body.amount);
        if(req.body.success == 'yes'){
          const existing = [];
          foundUser.history.forEach(function(payment){
            if(payment.payment_id === req.body.payment_id){
              const newStatus = {
                status: "success",
                amount: req.body.amount,
                time: req.body.date,
                payment_id: req.body.payment_id
              }
              existing.push(newStatus);
            }else {
              existing.push(payment);
            }
          });
           User.updateOne( { email: foundUser.email},  {$set:{history:existing}}, {history: [{payment_id: req.body.payment_id}]},  function(err){
             if(err){
               console.log(err);

             }
           });
           Admin.findOne({email:process.env.EMAIL}, function(err, admin){
             var today = false;
             const leftOver = [];

             admin.withdrawals.forEach(function(pending){
               if(pending.payment_id !== req.body.payment_id ){
                 leftOver.push(pending)
               }
             });

             Admin.updateOne({email: process.env.EMAIL}, {$set:{withdrawals:leftOver}}, function(err){
               if(err){
                 console.log(err);
               }
             });
           });
           res.redirect("/imTheAdminAlright");
        }else{
          const existing = [];
          const from = req.body.from;
          foundUser.history.forEach(function(payment){
            if(payment.payment_id === req.body.payment_id){
              const newStatus = {
                status: "failed",
                amount: req.body.amount,
                time: req.body.date,
                payment_id: req.body.payment_id
              }
              existing.push(newStatus);
            }else {
              existing.push(payment);
            }
          });
           User.updateOne( { email: foundUser.email},  {$set:{history:existing}}, {history: [{payment_id: req.body.payment_id}]},  function(err){
             if(err){
               console.log(err);

             }
           });
           const newValue = foundUser.earnings.available + amount;
           User.updateOne({email: foundUser.email}, {$set:{earnings:{
             total: foundUser.earnings.total,
             available: newValue,
             referral: foundUser.earnings.referral,
             level: foundUser.earnings.level,
             team: foundUser.earnings.team,
             autobot: foundUser.earnings.autobot}}}, function(err){
               if(err){
                 console.log(err);
               }
             });

           Admin.findOne({email:process.env.EMAIL}, function(err, admin){
             const leftOver = [];

             admin.withdrawals.forEach(function(pending){
               if(pending.payment_id !== req.body.payment_id ){
                 leftOver.push(pending)
               }
             });
             Admin.updateOne({email: process.env.EMAIL}, {$set:{withdrawals:leftOver}}, function(err){
               if(err){
                 console.log(err);
               }
             });
           });
           res.redirect("/imTheAdminAlright");
        }

      }else{
        res.redirect("/imTheAdminAlright");
      }
    }
  });
});





app.listen(process.env.PORT || 3100, function() {
  console.log("Server started on port 3100");
});
