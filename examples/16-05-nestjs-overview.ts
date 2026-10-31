// 文件: examples/16-05-nestjs-overview.ts —— NestJS 一瞥:装饰器 + 依赖注入(呼应 2.7)
// 安装:npm i -g @nestjs/cli && nest new my-api

// Controller:声明路由;Provider:可注入的服务 —— 装饰器是 Nest 的语法核心
// import { Controller, Get, Injectable, Module } from '@nestjs/common';

// @Injectable()                     // 标记为可注入服务(等价于 Angular 的 DI,见 4.6)
// export class UserService {
//     private readonly users = [{ id: 1, name: 'Alice' }];
//     findOne(id: number) {
//         return this.users.find((u) => u.id === id);
//     }
// }

// @Controller('users')
// export class UsersController {
//     constructor(private readonly userService: UserService) {} // 构造函数注入
//
//     @Get(':id')
//     getUser(@Param('id') id: string) {
//         return this.userService.findOne(Number(id));
//     }
// }

// 💡 前端学过 Angular(4.6)或 TS 装饰器(2.7)后,NestJS 的心智模型几乎零成本
export {};
