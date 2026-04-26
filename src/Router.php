<?php
declare(strict_types=1);

namespace RouteRush;

final class Router
{
    /** @var array<string, array<string, callable>> */
    private array $routes = [];

    public function get(string $path, callable $handler): void
    {
        $this->routes['GET'][$path] = $handler;
    }

    public function post(string $path, callable $handler): void
    {
        $this->routes['POST'][$path] = $handler;
    }

    public function dispatch(Request $request): Response
    {
        foreach ($this->routes[$request->method] ?? [] as $pattern => $handler) {
            $regex = '#^' . preg_replace('/\{(\w+)\}/', '(?<$1>[^/]+)', $pattern) . '$#';
            if (preg_match($regex, $request->path, $matches)) {
                $params = array_filter($matches, 'is_string', ARRAY_FILTER_USE_KEY);
                $result = $handler($request, $params);
                return $result instanceof Response ? $result : Response::html((string) $result);
            }
        }
        return Response::notFound();
    }
}
