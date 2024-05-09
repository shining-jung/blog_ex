require('dotenv').config();

const express = require('express');
const app = express();
const port = process.env.PORT;

const {MongoClient} = require('mongodb');
const uri = process.env.MONGODB_URL
const client = new MongoClient(uri);
const getDB = async () => {
    await client.connect();
    return client.db('blog');
};

const methodOverride = require('method-override');

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { error, log } = require('console');
const uploadDir = 'public/uploads/';
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir); // 파일이 저장될 경로를 지정
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname)); // 파일 이름 설정
    }
});
const upload = multer({ storage: storage });

const bcrypt = require('bcrypt');
const SALT_ROUNDS = parseInt(process.env.SALT_ROUNDS);

const jwt = require('jsonwebtoken');
const SECRET_KEY =  process.env.SECRET_KEY;


const cookieParser = require('cookie-parser');

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({extends:true}))
app.use(methodOverride('_method'));
app.use(cookieParser());
//모든 요청에 대해 쿠키를 검사
//토큰이 있다면 토큰을 해독해서 req.user에 userid를 저장 
app.use( async(req, res, next) => {
    const token = req.cookies.token
    if (token) {
        try {
            const data = jwt.verify(token, SECRET_KEY);
            const db = await getDB();
            const user = await db.collection('users').findOne({userId:data.userId});
            req.user = user ? user : null;
            // if (user) {
            //     req.user = user;
            // }            
        } catch(error) {
            console.log(error);
        }
    }
    next();
});

if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, {recursive : ture});

app.get('/', async (req, res) => {   
    try {
        const db = await getDB();
        const posting = await db.collection('posting').find().sort({createDate:-1}).limit(6).toArray();
        const totalPost =  (await db.collection('posting').find().toArray()).length;
        res.render('index', {posting, totalPost, userCk : req.user}); 
    } catch (error) {
        console.error(error); 
    }  
});

app.post('/getpost', async (req, res) => {    
    const listCount = parseInt(req.body.listCount); 
    const addPageNum = 3;
    try {       
        const db = await getDB();
        const addPosting = await db.collection('posting').find().sort({createDate:-1}).skip(listCount).limit(addPageNum).toArray();
        res.json(addPosting);
    } catch (error) {
        console.error(error); 
    }   
});


app.get('/write', (req, res) => {
    res.render('write', {userCk: req.user});
});

app.post('/write', upload.single('postImg'), async (req, res) => {
    const { user, title, desc } = req.body;
    const postImg = req.file ? req.file.filename : null;
    const createDate = new Date();
    try {
        let db = await getDB();
        const result = await db.collection('countPost').findOne({ name: 'count' });
        await db.collection('posting').insertOne({
            num: result.total + 1,
            user,
            createDate,
            userId : req.user.userId,             
            userName : req.user.userName,             
            title,
            desc,
            postImgPath: postImg ? `/uploads/${postImg}` : null,
        });
        await db.collection('countPost').updateOne({ name: 'count' }, { $inc: { total: 1 } });
        await db.collection('like').insertOne({postNum: result.total + 1, likeTotal: 0, likeMember: []});

        res.redirect('/');
    } catch (error) {
        console.error(error);
    }
});

app.get('/detail/:id', async (req, res) => {
    const num = parseInt(req.params.id);
    try {
        const db = await getDB();
        const posting = await db.collection('posting').findOne({num});
        const like = await db.collection('like').findOne({postNum : num});
        const comments = await db.collection('comment').find({postNum: num}).toArray();
        res.render('detail', {posting, like, userCk: req.user, comments});
    } catch (error) {
        console.error(error);
    }
});

app.get('/edit/:id', async (req, res) => {
    const num = parseInt(req.params.id)  
    try {
        const db = await getDB();
        const posting = await db.collection('posting').findOne({num});
        res.render('edit', {posting, userCk : req.user});
    } catch (error) {
        console.error(error);
    }
});

app.post('/edit/:id', upload.single('postImg'), async (req, res) => {    
    const { user, createDate, title, desc } = req.body;   
    const num = parseInt(req.params.id);     
    const oldImg =  req.body.oldImagPath.replace('uploads/', ''); 
    let postImg = req.file ? req.file.filename : null; 
    if (postImg == null && oldImg !== null ) {
        postImg = oldImg
    } else if (postImg == null && oldImg == null ){
        postImg = null
    }
    try {       
        const db = await getDB();
        await db.collection('posting').updateOne({ num }, {
            $set: { user, createDate, title, desc, postImgPath: `/uploads/${postImg}`, userId : req.user.userId, userName:req.user.userName }
        });             
    } catch (error) {
        console.error(error);
    }
    res.redirect('/');
});

app.post('/delete/:id', async (req, res) => {   
    const num = parseInt(req.params.id)    
    try {          
        const db = await getDB();
        await db.collection('posting').deleteOne({num});
        res.redirect('/');
    } catch (error) {
        console.error(error); 
    }    
});

app.get('/login', (req, res) => {
    res.render('login', {userCk : req.user});
});

app.post('/login', async (req, res)=>{
    const {userId, pw} = req.body;    
    try {
        let db = await getDB();
        const user = await db.collection('users').findOne({userId});       
        if(user) {
            const compareResult = await bcrypt.compare(pw, user.pw)
            if(compareResult) {   
                const token = jwt.sign({userId:user.userId}, SECRET_KEY);  
                res.cookie('token', token);
                res.redirect('/');
            } else {
                res.status(401).send()
            }            
        } else {
            res.status(404).send()
        }
    } catch (error) {
        console.log(error);
    }
});

app.get('/join', (req, res) => { 
    res.render('join', {userCk: req.user});
});

app.post('/join', async (req, res)=>{
    const { userId, pw, userName} = req.body;
    try {
        const hashedPW = await bcrypt.hash(pw, SALT_ROUNDS)

        let db = await getDB();
        await db.collection('users').insertOne({
            userId,
            pw : hashedPW,
            userName,
            userClass : 'u',
        });        
        res.redirect('/login');
    } catch (error) {
        console.log(error);
    }
});

app.get('/mypage', (req, res) => {   
    res.render('mypage', {userCk: req.user});
});

app.get('/personal/:userId', async (req, res) => {
    const postUser = req.params.userId
    try {
        const db = await getDB()
        const posting = await db.collection('posting').find({userId:postUser}).toArray();
        res.render('personal', {posting, userCk : req.user, postUser})
    } catch (error) {
        console.log(error);
    }
});

app.post('/like/:id', async (req,res) => {
    const postNum = parseInt(req.params.id);   
    try {
        const db = await getDB();
        const like = await db.collection('like').findOne({postNum : postNum});
        if (like.likeMember.includes(req.user.userId)) {
            await db.collection('like').updateOne({postNum : postNum}, {
                $inc : {likeTotal : -1},
                $pull : {likeMember : req.user.userId}
            });
        } else {
            await db.collection('like').updateOne({postNum : postNum}, {
                $inc : {likeTotal : 1},
                $push : {likeMember : req.user.userId}
            });
        }       
        res.redirect('/detail/'+ postNum)
    } catch (error) {
        console.log(error);
    }
});

app.post('/commonet/:num', async (req, res) => {
    const num = parseInt(req.params.num);
    const {comment} = req.body;
    const createAtDate = new Date();
    try {
        const db = await getDB();
        await db.collection('comment').insertOne({
            postNum : num,
            comment,
            createAtDate,
            userId: req.user.userId,
            userName : req.user.userName,
        });
        res.json({success : true});
    } catch (error) {
        console.log(error);
        res.json({success : false});
    }
});

app.get('/logout', (req, res) =>{
    res.clearCookie('token');
    res.redirect('/');
});

app.listen(port, ()=>{
    console.log(`포트 -- ${port}`);
});
