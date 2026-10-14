import { Router, type IRouter } from "express";
import healthRouter from "./health";
import rush10Router from "./rush10";

const router: IRouter = Router();

router.use(healthRouter);
router.use(rush10Router);

export default router;
