<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;

abstract class Controller
{
    /**
     * Текущий пользователь для маршрутов под middleware auth.
     *
     * @throws AuthenticationException
     */
    protected function authUser(?Request $request = null): User
    {
        $user = ($request ?? request())->user();

        if (! $user instanceof User) {
            throw new AuthenticationException;
        }

        return $user;
    }
}
